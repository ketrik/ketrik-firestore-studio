export type AccessRole = "public" | "auth" | "admin" | "owner" | "locked" | "custom";

export interface OperationAccess {
  role: AccessRole;
  condition?: string;
  isConditional?: boolean;
}

export interface CollectionSecurityAccess {
  read: OperationAccess;
  write: OperationAccess;
  rawRuleSnippet?: string;
}

export interface RuleMatchBlock {
  pattern: string;
  segments: string[];
  read?: OperationAccess;
  write?: OperationAccess;
  get?: OperationAccess;
  list?: OperationAccess;
  create?: OperationAccess;
  update?: OperationAccess;
  delete?: OperationAccess;
  snippet: string;
}

/**
 * Classify a security rule condition expression into an access role.
 */
function classifyCondition(conditionStr?: string): OperationAccess {
  if (!conditionStr) {
    return { role: "locked", condition: "denied" };
  }

  const cond = conditionStr.trim();

  if (cond === "true") {
    return { role: "public", condition: "if true" };
  }

  if (cond === "false") {
    return { role: "locked", condition: "if false" };
  }

  // Admin checks (e.g. request.auth.token.admin == true, request.auth.token.role == 'admin', isAdmin())
  if (
    /request\.auth\.token\.(admin|role\s*==\s*['"]admin['"])/i.test(cond) ||
    /\bisAdmin\s*\(/i.test(cond)
  ) {
    return { role: "admin", condition: cond };
  }

  // Owner checks (e.g. request.auth.uid == userId, resource.data.userId == request.auth.uid)
  if (
    /request\.auth\.uid\s*==/i.test(cond) ||
    /==\s*request\.auth\.uid/i.test(cond) ||
    /resource\.data\.(owner|uid|user_?id|created_?by)\s*==\s*request\.auth\.uid/i.test(cond)
  ) {
    return { role: "owner", condition: cond };
  }

  // Authenticated checks (e.g. request.auth != null, isAuthenticated(), isSignedIn())
  if (
    /request\.auth\s*!=\s*null/i.test(cond) ||
    /\b(isLoggedIn|isAuthenticated|isSignedIn|isAuthed)\s*\(/i.test(cond)
  ) {
    // If combined with other conditions via || or &&, note as conditional
    const isConditional = cond.includes("&&") || cond.includes("||");
    return { role: "auth", condition: cond, isConditional };
  }

  // Check for public access with conditions (e.g. resource.data.isPublished == true)
  if (cond.includes("request.auth") === false) {
    return { role: "public", condition: cond, isConditional: true };
  }

  return { role: "custom", condition: cond, isConditional: true };
}

/**
 * Parser for firestore.rules that extracts match blocks and evaluates collection access.
 */
export class RulesParser {
  private blocks: RuleMatchBlock[] = [];
  private functions = new Map<string, string>();

  constructor(rulesContent: string) {
    this.parse(rulesContent);
  }

  /**
   * Parse firestore.rules source into structured match blocks with full nested hierarchy support.
   */
  private parse(content: string): void {
    this.blocks = [];
    this.functions.clear();

    // 1. Strip comments
    const cleaned = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

    // 2. Extract helper functions: function name(...) { return expr; }
    const fnRegex = /function\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{([\s\S]*?)\}/g;
    let fnMatch: RegExpExecArray | null;
    while ((fnMatch = fnRegex.exec(cleaned)) !== null) {
      const fnName = fnMatch[1];
      const fnBody = fnMatch[2];
      const retMatch = /return\s+([\s\S]*?);/.exec(fnBody);
      if (retMatch) {
        this.functions.set(fnName, retMatch[1].replace(/\s+/g, " ").trim());
      }
    }

    // 3. Tokenize / parse nested match blocks
    this.blocks = [];
    this.extractBlocksRecursive(cleaned, "");
  }

  private extractBlocksRecursive(text: string, currentPath: string): void {
    let pos = 0;
    while (pos < text.length) {
      const matchIdx = text.indexOf("match", pos);
      if (matchIdx === -1) break;

      const before = matchIdx > 0 ? text[matchIdx - 1] : " ";
      if (/\w/.test(before)) {
        pos = matchIdx + 5;
        continue;
      }

      let pathStart = matchIdx + 5;
      while (pathStart < text.length && /\s/.test(text[pathStart])) pathStart++;

      let idx = pathStart;
      let inPathVar = false;
      let blockOpenBrace = -1;

      while (idx < text.length) {
        if (text[idx] === "{") {
          if (idx > pathStart && (text[idx - 1] === "/" || text[idx - 1] === "=")) {
            inPathVar = true;
          } else if (!inPathVar) {
            blockOpenBrace = idx;
            break;
          }
        } else if (text[idx] === "}") {
          if (inPathVar) {
            inPathVar = false;
          }
        }
        idx++;
      }

      if (blockOpenBrace === -1) break;

      const rawPath = text.substring(pathStart, blockOpenBrace).trim();

      // Find matching closing brace for the block
      let depth = 1;
      let cur = blockOpenBrace + 1;
      while (cur < text.length && depth > 0) {
        if (text[cur] === "{") depth++;
        else if (text[cur] === "}") depth--;
        cur++;
      }

      const blockBody = text.substring(blockOpenBrace + 1, cur - 1);
      const combinedPath = currentPath
        ? `${currentPath.replace(/\/$/, "")}/${rawPath.replace(/^\//, "")}`
        : rawPath;
      const segments = combinedPath.split("/").filter(Boolean);

      // Extract allow rules in this block's immediate body (ignoring nested match blocks)
      const localBody = this.stripNestedMatchBlocks(blockBody);
      const allowRegex = /allow\s+([^:]+):\s*if\s+([\s\S]*?);/g;
      let a: RegExpExecArray | null;

      const block: RuleMatchBlock = {
        pattern: combinedPath,
        segments,
        snippet: `match ${rawPath} {\n${blockBody.trim()}\n}`,
      };

      while ((a = allowRegex.exec(localBody)) !== null) {
        const ops = a[1].split(",").map((o) => o.trim());
        let cond = a[2].replace(/\s+/g, " ").trim();

        // Expand top-level function calls in condition if known
        for (const [fnName, fnExpr] of this.functions.entries()) {
          if (cond.includes(`${fnName}(`)) {
            cond = cond.replace(new RegExp(`\\b${fnName}\\s*\\([^)]*\\)`, "g"), `(${fnExpr})`);
          }
        }

        const access = classifyCondition(cond);

        for (const op of ops) {
          if (op === "read") block.read = access;
          else if (op === "write") block.write = access;
          else if (op === "get") block.get = access;
          else if (op === "list") block.list = access;
          else if (op === "create") block.create = access;
          else if (op === "update") block.update = access;
          else if (op === "delete") block.delete = access;
        }
      }

      const isDatabaseRoot = segments.length <= 2 && segments[0] === "databases";
      if (!isDatabaseRoot && (block.read || block.write || block.get || block.list || block.create || block.update || block.delete)) {
        this.blocks.push(block);
      }

      // Recursively parse inner match blocks
      this.extractBlocksRecursive(blockBody, combinedPath);

      pos = cur;
    }
  }

  private stripNestedMatchBlocks(body: string): string {
    let result = "";
    let pos = 0;
    while (pos < body.length) {
      const matchIdx = body.indexOf("match", pos);
      if (matchIdx === -1) {
        result += body.substring(pos);
        break;
      }

      const before = matchIdx > 0 ? body[matchIdx - 1] : " ";
      if (/\w/.test(before)) {
        result += body.substring(pos, matchIdx + 5);
        pos = matchIdx + 5;
        continue;
      }

      result += body.substring(pos, matchIdx);

      // Find open brace
      let idx = matchIdx + 5;
      let inPathVar = false;
      let openBrace = -1;
      while (idx < body.length) {
        if (body[idx] === "{") {
          if (idx > matchIdx + 5 && (body[idx - 1] === "/" || body[idx - 1] === "=")) {
            inPathVar = true;
          } else if (!inPathVar) {
            openBrace = idx;
            break;
          }
        } else if (body[idx] === "}") {
          if (inPathVar) inPathVar = false;
        }
        idx++;
      }

      if (openBrace === -1) {
        result += body.substring(matchIdx);
        break;
      }

      // Skip past matching closing brace
      let depth = 1;
      let cur = openBrace + 1;
      while (cur < body.length && depth > 0) {
        if (body[cur] === "{") depth++;
        else if (body[cur] === "}") depth--;
        cur++;
      }

      pos = cur;
    }
    return result;
  }

  /**
   * Determine the access level for a specific collection path (e.g., "registers", "users", or "users/123/posts").
   */
  public getAccessForCollection(collPath: string): CollectionSecurityAccess {
    const collSegments = collPath.split("/").filter(Boolean);

    // Find all matching blocks, scored by specificity (most specific wins over wildcards)
    let matchedBlock: RuleMatchBlock | null = null;
    let fallbackBlock: RuleMatchBlock | null = null;
    let bestScore = -1;

    for (const b of this.blocks) {
      // Normalize rule segments (strip databases/{database}/documents prefix if present)
      let effectiveSegments = b.segments;
      if (effectiveSegments.length >= 2 && effectiveSegments[0] === "databases" && effectiveSegments[1].startsWith("{")) {
        effectiveSegments = effectiveSegments.slice(2);
      }
      if (effectiveSegments.length >= 1 && effectiveSegments[0] === "documents") {
        effectiveSegments = effectiveSegments.slice(1);
      }

      // Check for global wildcard /{document=**}
      if (
        effectiveSegments.length === 1 &&
        (effectiveSegments[0].includes("=**") || effectiveSegments[0].includes("{document=**}"))
      ) {
        fallbackBlock = b;
        continue;
      }

      if (this.pathMatches(collSegments, effectiveSegments)) {
        // Specificity scoring: literal segment match > single wildcard > recursive wildcard
        let score = 0;
        const isRecursive = effectiveSegments.some((s) => s.includes("=**"));
        for (let i = 0; i < collSegments.length; i++) {
          const ruleIdx = i * 2;
          if (ruleIdx < effectiveSegments.length) {
            const seg = effectiveSegments[ruleIdx];
            if (seg === collSegments[i]) {
              score += 10;
            } else if (seg.startsWith("{") && !seg.includes("=**")) {
              score += 5;
            } else if (seg.includes("=**")) {
              score += 1;
            }
          }
        }
        if (!isRecursive) {
          score += 10;
        }
        if (score > bestScore) {
          bestScore = score;
          matchedBlock = b;
        }
      }
    }

    const chosenBlock = matchedBlock || fallbackBlock;

    if (!chosenBlock) {
      return {
        read: { role: "locked", condition: "no rule matched (default deny)" },
        write: { role: "locked", condition: "no rule matched (default deny)" },
      };
    }

    // Combine access: specific block might specify only read or only write, fallback can satisfy the other!
    const readAccess =
      chosenBlock.read || chosenBlock.list || chosenBlock.get ||
      (fallbackBlock ? (fallbackBlock.read || fallbackBlock.list || fallbackBlock.get) : undefined) ||
      { role: "locked", condition: "denied" };

    const writeAccess =
      chosenBlock.write || chosenBlock.create || chosenBlock.update || chosenBlock.delete ||
      (fallbackBlock ? (fallbackBlock.write || fallbackBlock.create || fallbackBlock.update || fallbackBlock.delete) : undefined) ||
      { role: "locked", condition: "denied" };

    return {
      read: readAccess,
      write: writeAccess,
      rawRuleSnippet: chosenBlock.snippet,
    };
  }

  /**
   * Check if collection segments match a rule pattern's segments.
   * e.g. ["registers"] matches ["registers", "{document=**}"] or ["registers", "{docId}"]
   * e.g. ["users"] matches ["users", "{userId}"]
   */
  private pathMatches(collSegments: string[], ruleSegments: string[]): boolean {
    if (collSegments.length === 0 || ruleSegments.length === 0) return false;

    // Rule segments start with the collection name
    const firstRuleSegment = ruleSegments[0];
    if (firstRuleSegment.includes("=**")) {
      return true;
    }

    if (firstRuleSegment !== collSegments[0] && !firstRuleSegment.startsWith("{")) {
      return false;
    }

    // Match deeper segments if nested
    for (let i = 0; i < collSegments.length; i++) {
      const collPart = collSegments[i];
      const ruleIndex = i * 2; // rule has document placeholder between subcollections

      if (ruleIndex >= ruleSegments.length) {
        // Check if previous segment was recursive wildcard =**
        if (ruleSegments[ruleSegments.length - 1]?.includes("=**")) {
          return true;
        }
        return false;
      }

      const rulePart = ruleSegments[ruleIndex];
      if (rulePart.includes("=**")) {
        return true;
      }
      if (rulePart !== collPart && !rulePart.startsWith("{")) {
        return false;
      }
    }

    return true;
  }

  /**
   * Format the access level into a minimal icon-only indicator for the tree,
   * keeping all detailed explanations inside the hover tooltip with rich icons
   * for instant visual identification of Read and Write permissions.
   */
  public static formatBadge(access: CollectionSecurityAccess): {
    badge: string;
    tooltip: string;
  } {
    const roleIcons: Record<AccessRole, string> = {
      public: "🌐 Public (Unauthenticated)",
      auth: "🔒 Any Logged-in User",
      admin: "🔑 Admin Role Only",
      owner: "👤 Owner Only (User-Isolated)",
      locked: "🛡️ Backend Only (Admin SDK / Denied)",
      custom: "⚙️ Custom Rule",
    };

    const r = access.read;
    const w = access.write;

    let badge = "";

    // Minimal icon-only indicator for tree row:
    if (r.role === "public" && w.role === "public") {
      badge = "🚨"; // Critical public read/write
    } else if (r.role === "public" || w.role === "public") {
      badge = "⚠️ 🌐"; // Partially public
    } else if (r.role === "locked" && w.role === "locked") {
      badge = "🛡️"; // Private backend-only
    } else if (r.role === "admin" || w.role === "admin") {
      badge = "🔑"; // Admin restricted
    } else if (r.role === "owner" || w.role === "owner") {
      badge = "👤"; // User isolated
    } else if (r.role === "auth" && w.role === "auth") {
      badge = "🔒"; // Standard authenticated
    } else {
      badge = "⚙️"; // Custom rule
    }

    const lines: string[] = [
      `Security Rules Access:`,
      `📖 Read:   ${roleIcons[r.role]} [${r.condition || "default"}]`,
      `✍️ Write:  ${roleIcons[w.role]} [${w.condition || "default"}]`,
    ];

    if (r.role === "public" && w.role === "public") {
      lines.push(`🚨 CRITICAL: Anyone on the internet can read and write this collection!`);
    } else if (r.role === "public") {
      lines.push(`⚠️ ATTENTION: Public unauthenticated read access is permitted.`);
    } else if (w.role === "public") {
      lines.push(`🚨 ATTENTION: Public unauthenticated write access is permitted!`);
    } else if (r.role === "locked" && w.role === "locked") {
      lines.push(`🛡️ Private: Accessible only via Admin SDK / server backend.`);
    }

    if (access.rawRuleSnippet) {
      lines.push(`\nRule:\n${access.rawRuleSnippet}`);
    }

    const tooltip = lines.join("\n");

    return { badge, tooltip };
  }
}
