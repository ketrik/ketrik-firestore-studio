import * as vscode from "vscode";

export interface DocumentTemplate {
  label: string;
  data: any;
}

/**
 * Service to manage and cache document templates loaded from workspace configuration.
 */
export class TemplateService {
  private static instance: TemplateService;
  private templateCache: DocumentTemplate[] | null = null;

  private constructor() {}

  public static getInstance(): TemplateService {
    if (!TemplateService.instance) {
      TemplateService.instance = new TemplateService();
    }
    return TemplateService.instance;
  }

  public getTemplates(): DocumentTemplate[] {
    if (this.templateCache !== null) {
      return this.templateCache;
    }

    const config = vscode.workspace.getConfiguration("ketrik-firestore-studio");
    const templates = config.get<any[]>("documentTemplates") || [];

    this.templateCache = templates.map((t) => ({
      label: t.name || t.label || "Template",
      data: (() => {
        try {
          return typeof t.template === "string" ? JSON.parse(t.template) : t.data || {};
        } catch {
          return {};
        }
      })(),
    }));

    return this.templateCache;
  }

  public invalidate(): void {
    this.templateCache = null;
  }
}
