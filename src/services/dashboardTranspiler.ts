/**
 * Ketrik Firestore Studio — Dashboard Transpiler & Decompiler Engine
 *
 * Provides bidirectional compilation between verbose runtime dashboard JSON (1000+ lines,
 * repeated JSONLogic, duplicated colorRules/styles across tables) and a concise, DRY
 * format (~100 lines) with centralized presets, shared templates, and unified column definitions.
 */

export interface DryRuleCondition {
  "<="?: number;
  "<"?: number;
  ">="?: number;
  ">"?: number;
  "=="?: any;
  "!="?: any;
  between?: [number, number];
  result: string;
  rawCondition?: any;
}

export interface DryColumnDefinition {
  id: string;
  title?: string;
  width?: number;
  align?: "center" | "left" | "right" | string;
  format?: "currency" | "percent" | "number" | string;
  colorRule?: string;
  visual?: {
    type: "info" | "sparkline" | string;
    config?: Record<string, any>;
    [key: string]: any;
  };
}

export interface DryTableTemplate {
  density?: string;
  idColumnName?: string;
  pageSize?: number;
  hideFooter?: boolean;
  defaultColumnWidth?: number;
  columns: DryColumnDefinition[];
  extraHeaderTitles?: Record<string, string>;
  extraColumnsAlign?: Record<string, string>;
  extraColumnWidths?: Record<string, number>;
  extraColumnsVisuals?: Record<string, any>;
  extraColorRules?: Record<string, string>;
  extraDataFormatters?: Record<string, string>;
}

export interface DryDashboardPresets {
  styles?: Record<string, { background?: string; color?: string; [key: string]: any }>;
  rules?: Record<string, DryRuleCondition[]>;
  tableTemplates?: Record<string, DryTableTemplate>;
  commonHeaders?: Record<string, string>;
  commonAligns?: Record<string, string>;
  commonWidths?: Record<string, number>;
}

export interface DryTableItem {
  type: "table";
  dataKey: string;
  title?: string;
  subheader?: string;
  template?: string;
  size?: { md?: number; [key: string]: any };
  columns?: DryColumnDefinition[];
  columnOverrides?: Record<string, Partial<DryColumnDefinition>>;
  formatters?: Record<string, string>;
  colorRules?: Record<string, string>;
  visualOverrides?: Record<string, any>;
  density?: string;
  pageSize?: number;
  hideFooter?: boolean;
  rawExtras?: Record<string, any>;
}

export interface DryAreaChartItem {
  type: "areaChart" | "chart";
  dataKey: string;
  title?: string;
  height?: number;
  size?: { md?: number; [key: string]: any };
  series?: Array<{
    dataKey: string;
    label?: string;
    color?: string;
    showMark?: boolean;
  }>;
  xAxisKey?: string;
  scaleType?: string;
  notation?: string;
  hideLegend?: boolean;
  chartOptions?: Record<string, any>;
  contentConfig?: Record<string, any>;
  rawChart?: any;
}

export interface DryPlotlyItem {
  type: "plotly";
  dataKey: string;
  size?: { md?: number; [key: string]: any };
  rawExtras?: Record<string, any>;
}

export interface DryGroup {
  header?: string;
  itemSize?: { md?: number; [key: string]: any };
  items: Array<DryTableItem | DryAreaChartItem | DryPlotlyItem | Record<string, any>>;
}

export interface DryDashboardDocument {
  $format: "ketrik-dashboard-dry-v1";
  header: string;
  initData?: any[];
  presets: DryDashboardPresets;
  groups: DryGroup[];
  rawMeta?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Helpers: JSONLogic <-> Shorthand Conditions
// ---------------------------------------------------------------------------

export function jsonLogicToCondition(rule: { condition: any; result: string }): DryRuleCondition {
  const result = rule.result;
  const cond = rule.condition;
  if (!cond || typeof cond !== "object") {
    return { result, rawCondition: cond };
  }

  const andClauses: any[] = Array.isArray(cond.and) ? cond.and : [cond];
  const dry: DryRuleCondition = { result };
  let parsedAll = true;

  for (const clause of andClauses) {
    if (!clause || typeof clause !== "object") {
      parsedAll = false;
      continue;
    }
    const ops = Object.keys(clause);
    if (ops.length !== 1) {
      parsedAll = false;
      continue;
    }
    const op = ops[0];
    const args = clause[op];
    if (Array.isArray(args) && args.length === 2) {
      const isVar = args[0] && typeof args[0] === "object" && args[0].var === "value";
      if (isVar) {
        const val = args[1];
        if (op === "<=") dry["<="] = val;
        else if (op === "<") dry["<"] = val;
        else if (op === ">=") dry[">="] = val;
        else if (op === ">") dry[">"] = val;
        else if (op === "==") dry["=="] = val;
        else if (op === "!=") dry["!="] = val;
        else parsedAll = false;
      } else {
        parsedAll = false;
      }
    } else {
      parsedAll = false;
    }
  }

  // Optimize > X and < Y to between: [X, Y] if applicable
  if (dry[">"] !== undefined && dry["<"] !== undefined && Object.keys(dry).length === 3) {
    dry.between = [dry[">"]!, dry["<"]!];
    delete dry[">"];
    delete dry["<"];
  }

  if (!parsedAll) {
    dry.rawCondition = cond;
  }
  return dry;
}

export function conditionToJsonLogic(cond: DryRuleCondition): { condition: any; result: string } {
  if (cond.rawCondition) {
    return { condition: cond.rawCondition, result: cond.result };
  }

  const clauses: any[] = [];
  if (cond["<="] !== undefined) {
    clauses.push({ "<=": [{ var: "value" }, cond["<="]] });
  }
  if (cond["<"] !== undefined) {
    clauses.push({ "<": [{ var: "value" }, cond["<"]] });
  }
  if (cond[">="] !== undefined) {
    clauses.push({ ">=": [{ var: "value" }, cond[">="]] });
  }
  if (cond[">"] !== undefined) {
    clauses.push({ ">": [{ var: "value" }, cond[">"]] });
  }
  if (cond["=="] !== undefined) {
    clauses.push({ "==": [{ var: "value" }, cond["=="]] });
  }
  if (cond["!="] !== undefined) {
    clauses.push({ "!=": [{ var: "value" }, cond["!="]] });
  }
  if (cond.between !== undefined) {
    clauses.push({ ">": [{ var: "value" }, cond.between[0]] });
    clauses.push({ "<": [{ var: "value" }, cond.between[1]] });
  }

  return {
    condition: { and: clauses },
    result: cond.result,
  };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function isRuntimeDashboard(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  const target = obj.config || obj;
  if (!target || typeof target !== "object") return false;
  if (!Array.isArray(target.groups)) return false;
  return target.groups.some((g: any) =>
    Array.isArray(g.items) &&
    g.items.some((it: any) => it.cardConfig || it.chart || (it.contentConfig && it.contentConfig.contentType))
  );
}

export function isDryDashboard(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  return obj.$format === "ketrik-dashboard-dry-v1" || (!!obj.presets && Array.isArray(obj.groups));
}

// ---------------------------------------------------------------------------
// Decompiler: Runtime JSON -> DRY Dashboard
// ---------------------------------------------------------------------------

export function decompileDashboard(rawDoc: any): DryDashboardDocument {
  const root = rawDoc && rawDoc.config ? rawDoc.config : rawDoc;
  const rawMeta: Record<string, any> = {};
  if (rawDoc && rawDoc.config) {
    for (const [k, v] of Object.entries(rawDoc)) {
      if (k !== "config") rawMeta[k] = v;
    }
  }

  const collectedStyles: Record<string, any> = {};
  const collectedRules: Record<string, DryRuleCondition[]> = {};
  const commonHeaders: Record<string, string> = {};
  const commonAligns: Record<string, string> = {};
  const commonWidths: Record<string, number> = {};
  const tableRuleResolutions = new Map<string, Record<string, string>>();

  // First pass: collect styles, deduplicate rules, and extract common dictionaries
  for (const group of root.groups || []) {
    for (const item of group.items || []) {
      if (item.cardConfig && Array.isArray(item.cardConfig)) {
        const contentBlock = item.cardConfig.find((c: any) => c.type === "cardContent");
        if (contentBlock && contentBlock.contentConfig) {
          const cc = contentBlock.contentConfig;
          if (cc.colorStyles) {
            Object.assign(collectedStyles, cc.colorStyles);
          }
          if (cc.colorRules) {
            const tableRuleMap: Record<string, string> = {};
            for (const [origName, ruleClauses] of Object.entries<any[]>(cc.colorRules)) {
              if (Array.isArray(ruleClauses)) {
                const dryConditions = ruleClauses.map(jsonLogicToCondition);

                // Find if an identical set of conditions has already been collected
                let matchedName = Object.keys(collectedRules).find(
                  (name) =>
                    (name === origName || name.startsWith(origName + "_")) &&
                    JSON.stringify(collectedRules[name]) === JSON.stringify(dryConditions)
                );

                if (!matchedName) {
                  if (!collectedRules[origName]) {
                    collectedRules[origName] = dryConditions;
                    matchedName = origName;
                  } else {
                    matchedName = `${origName}_binary`;
                    let counter = 1;
                    while (collectedRules[matchedName]) {
                      matchedName = `${origName}_alt${counter++}`;
                    }
                    collectedRules[matchedName] = dryConditions;
                  }
                }
                tableRuleMap[origName] = matchedName;
              }
            }
            if (contentBlock.dataKey) {
              tableRuleResolutions.set(contentBlock.dataKey, tableRuleMap);
            }
          }
          if (cc.headerTitles) {
            Object.assign(commonHeaders, cc.headerTitles);
          }
          if (cc.columnsAlign) {
            Object.assign(commonAligns, cc.columnsAlign);
          }
          if (cc.columnWidths) {
            Object.assign(commonWidths, cc.columnWidths);
          }
        }
      }
    }
  }

  // Build a default table template based on the most common DataGrid pattern
  let templateColumns: DryColumnDefinition[] = [];
  let templateSampleCC: any = null;

  for (const group of root.groups || []) {
    for (const item of group.items || []) {
      if (item.cardConfig && Array.isArray(item.cardConfig)) {
        const contentBlock = item.cardConfig.find((c: any) => c.type === "cardContent");
        if (contentBlock && contentBlock.contentConfig && Array.isArray(contentBlock.contentConfig.columns)) {
          templateSampleCC = contentBlock.contentConfig;
          const cols: string[] = templateSampleCC.columns;
          templateColumns = cols.map((colId) => {
            const def: DryColumnDefinition = { id: colId };
            if (templateSampleCC.headerTitles && templateSampleCC.headerTitles[colId]) {
              def.title = templateSampleCC.headerTitles[colId];
            }
            if (templateSampleCC.columnWidths && templateSampleCC.columnWidths[colId]) {
              def.width = templateSampleCC.columnWidths[colId];
            }
            if (templateSampleCC.columnsAlign && templateSampleCC.columnsAlign[colId]) {
              def.align = templateSampleCC.columnsAlign[colId];
            }
            if (templateSampleCC.columnsVisuals && templateSampleCC.columnsVisuals[colId]) {
              def.visual = templateSampleCC.columnsVisuals[colId];
            }
            if (templateSampleCC.columnsColorRules && templateSampleCC.columnsColorRules[colId]) {
              def.colorRule = templateSampleCC.columnsColorRules[colId];
            }
            if (templateSampleCC.dataFormatters && templateSampleCC.dataFormatters[colId]) {
              def.format = templateSampleCC.dataFormatters[colId];
            }
            return def;
          });
          break;
        }
      }
    }
    if (templateSampleCC) break;
  }

  const tableTemplates: Record<string, DryTableTemplate> = {};
  if (templateSampleCC) {
    tableTemplates["standardRiskGrid"] = {
      density: templateSampleCC.density || "comfortable",
      idColumnName: templateSampleCC.idColumnName || "Metric",
      pageSize: templateSampleCC.pageSize || 100,
      hideFooter: templateSampleCC.hideFooter !== undefined ? templateSampleCC.hideFooter : true,
      defaultColumnWidth: templateSampleCC.columnWidth || 150,
      columns: templateColumns,
    };
  }

  // Second pass: map groups and items into DRY items
  const dryGroups: DryGroup[] = (root.groups || []).map((grp: any) => {
    const dryGrp: DryGroup = {
      header: grp.header,
      itemSize: grp.itemSize,
      items: [],
    };

    for (const item of grp.items || []) {
      // Area / Line Chart
      if (item.chart) {
        const series = (item.chart.series || []).map((s: any) => ({
          dataKey: s.dataKey,
          label: s.label,
          color: s.color,
          showMark: s.showMark,
        }));
        const xAxisKey = item.chart.xAxis && item.chart.xAxis[0] ? item.chart.xAxis[0].dataKey : undefined;
        const scaleType = item.chart.xAxis && item.chart.xAxis[0] ? item.chart.xAxis[0].scaleType : undefined;

        dryGrp.items.push({
          type: "areaChart",
          dataKey: item.dataKey,
          title: item.title,
          height: item.chartOptions?.height || 200,
          size: item.size,
          series,
          xAxisKey,
          scaleType,
          notation: item.notation,
          hideLegend: item.contentConfig?.hideLegend || item.chart?.hideLegend,
          contentConfig: item.contentConfig,
          chartOptions: item.chartOptions,
        });
      }
      // Plotly
      else if (item.contentConfig && item.contentConfig.contentType === "Plotly") {
        dryGrp.items.push({
          type: "plotly",
          dataKey: item.dataKey,
          size: item.size,
        });
      }
      // DataGrid Card
      else if (item.cardConfig && Array.isArray(item.cardConfig)) {
        const headerBlock = item.cardConfig.find((c: any) => c.type === "cardHeader");
        const contentBlock = item.cardConfig.find((c: any) => c.type === "cardContent");
        const cc = contentBlock?.contentConfig || {};
        const ruleMap = contentBlock?.dataKey ? tableRuleResolutions.get(contentBlock.dataKey) : undefined;

        const resolvedColorRules: Record<string, string> = {};
        if (cc.columnsColorRules) {
          for (const [col, rName] of Object.entries<string>(cc.columnsColorRules)) {
            resolvedColorRules[col] = (ruleMap && ruleMap[rName]) || rName;
          }
        }

        const dryTable: DryTableItem = {
          type: "table",
          dataKey: contentBlock?.dataKey || "",
          title: headerBlock?.defaults?.title,
          subheader: headerBlock?.defaults?.subheader,
          template: "standardRiskGrid",
          size: headerBlock?.defaults?.size,
          formatters: cc.dataFormatters,
          colorRules: Object.keys(resolvedColorRules).length ? resolvedColorRules : undefined,
        };

        // Detect any visual overrides from the base template
        if (cc.columnsVisuals && templateSampleCC) {
          const overrides: Record<string, any> = {};
          for (const [col, vis] of Object.entries(cc.columnsVisuals)) {
            const baseVis = templateSampleCC.columnsVisuals?.[col];
            if (JSON.stringify(vis) !== JSON.stringify(baseVis)) {
              overrides[col] = vis;
            }
          }
          if (Object.keys(overrides).length > 0) {
            dryTable.visualOverrides = overrides;
          }
        }

        dryGrp.items.push(dryTable);
      }
      // Fallback: pass-through raw item
      else {
        dryGrp.items.push(item);
      }
    }
    return dryGrp;
  });

  return {
    $format: "ketrik-dashboard-dry-v1",
    header: root.header || "",
    initData: root.initData || [],
    presets: {
      styles: collectedStyles,
      rules: collectedRules,
      tableTemplates,
      commonHeaders,
      commonAligns,
      commonWidths,
    },
    groups: dryGroups,
    rawMeta: Object.keys(rawMeta).length ? rawMeta : undefined,
  };
}

// ---------------------------------------------------------------------------
// Compiler: DRY Dashboard -> Runtime JSON
// ---------------------------------------------------------------------------

export function compileDashboard(dryDoc: DryDashboardDocument): any {
  const presets = dryDoc.presets || {};
  const styles = presets.styles || {};
  const rules = presets.rules || {};
  const templates = presets.tableTemplates || {};

  // Build JSONLogic rules map
  const runtimeColorRules: Record<string, Array<{ condition: any; result: string }>> = {};
  for (const [ruleName, conditions] of Object.entries(rules)) {
    runtimeColorRules[ruleName] = conditions.map(conditionToJsonLogic);
  }

  const compiledGroups = (dryDoc.groups || []).map((grp) => {
    const compiledItems = (grp.items || []).map((item: any) => {
      // Area / Line Chart
      if (item.type === "areaChart" || item.type === "chart") {
        return {
          chart: {
            chartOptions: item.chartOptions || {},
            hideLegend: item.hideLegend ?? false,
            series: (item.series || []).map((s: any) => ({
              color: s.color || "darkred",
              dataKey: s.dataKey,
              label: s.label || "",
              showMark: s.showMark ?? true,
            })),
            xAxis: [
              {
                dataKey: item.xAxisKey || "Metric",
                scaleType: item.scaleType || "band",
              },
            ],
            yAxis: [{}],
          },
          chartOptions: {
            height: item.height || 200,
            ...(item.chartOptions || {}),
          },
          contentConfig: {
            area: true,
            chartAutoMap: true,
            chartType: "area",
            hideLegend: item.hideLegend ?? false,
            showMark: true,
            ...(item.contentConfig || {}),
          },
          dataKey: item.dataKey,
          notation: item.notation || "compact",
          size: item.size || { md: 12 },
          title: item.title ?? "",
        };
      }

      // Plotly
      if (item.type === "plotly") {
        return {
          contentConfig: {
            contentType: "Plotly",
          },
          dataKey: item.dataKey,
          size: item.size || { md: 6 },
        };
      }

      // Table (DataGrid Card)
      if (item.type === "table") {
        const tmpl = item.template ? templates[item.template] : null;

        // Columns definition resolution
        const sourceColumns: DryColumnDefinition[] = item.columns || tmpl?.columns || [];
        const columns = sourceColumns.map((c) => c.id);
        const columnWidths: Record<string, number> = { ...(tmpl?.extraColumnWidths || presets.commonWidths || {}) };
        const headerTitles: Record<string, string> = { ...(tmpl?.extraHeaderTitles || presets.commonHeaders || {}) };
        const columnsAlign: Record<string, string> = { ...(tmpl?.extraColumnsAlign || presets.commonAligns || {}) };
        const columnsVisuals: Record<string, any> = { ...(tmpl?.extraColumnsVisuals || {}) };
        const columnsColorRules: Record<string, string> = { ...(tmpl?.extraColorRules || {}), ...(item.colorRules || {}) };
        const dataFormatters: Record<string, string> = { ...(tmpl?.extraDataFormatters || {}), ...(item.formatters || {}) };

        for (const col of sourceColumns) {
          if (col.width) columnWidths[col.id] = col.width;
          if (col.title !== undefined) headerTitles[col.id] = col.title;
          if (col.align) columnsAlign[col.id] = col.align;
          if (col.format && !dataFormatters[col.id]) dataFormatters[col.id] = col.format;
          if (col.colorRule && !columnsColorRules[col.id]) columnsColorRules[col.id] = col.colorRule;
          if (col.visual) columnsVisuals[col.id] = col.visual;
        }

        // Apply visual overrides
        if (item.visualOverrides) {
          Object.assign(columnsVisuals, item.visualOverrides);
        }

        // Build target table's colorRules dictionary
        // If columnsColorRules references rules like threshold_0_binary, we map them back
        const tableColorRules: Record<string, any> = {};
        for (const [targetName, runtimeRule] of Object.entries(runtimeColorRules)) {
          // Base name e.g. "threshold_0"
          const baseName = targetName.split("_")[0] + (targetName.includes("threshold_") ? `_${targetName.split("_")[1]}` : "");
          tableColorRules[targetName] = runtimeRule;
          if (!tableColorRules[baseName]) {
            tableColorRules[baseName] = runtimeRule;
          }
        }

        // Ensure any rule referenced in columnsColorRules is present in tableColorRules
        const finalColumnsColorRules: Record<string, string> = {};
        for (const [col, ruleRef] of Object.entries(columnsColorRules)) {
          if (runtimeColorRules[ruleRef]) {
            finalColumnsColorRules[col] = ruleRef;
            tableColorRules[ruleRef] = runtimeColorRules[ruleRef];
          } else {
            finalColumnsColorRules[col] = ruleRef;
          }
        }

        const cardHeader: any = {
          defaults: {
            title: item.title || "",
            subheader: item.subheader || "",
          },
          type: "cardHeader",
        };
        if (item.size) {
          cardHeader.defaults.size = item.size;
        }

        const cardContent: any = {
          contentConfig: {
            colorRules: tableColorRules,
            colorStyles: styles,
            columnWidth: tmpl?.defaultColumnWidth || 150,
            columnWidths,
            columns,
            columnsAlign,
            columnsColorRules: finalColumnsColorRules,
            columnsVisuals,
            contentType: "DataGridContent",
            dataFormatters,
            density: item.density || tmpl?.density || "comfortable",
            headerTitles,
            hideFooter: item.hideFooter !== undefined ? item.hideFooter : (tmpl?.hideFooter ?? true),
            idColumnName: tmpl?.idColumnName || "Metric",
            pageSize: item.pageSize || tmpl?.pageSize || 100,
          },
          dataKey: item.dataKey,
          type: "cardContent",
        };

        return {
          cardConfig: [cardHeader, cardContent],
        };
      }

      // Passthrough item
      return item;
    });

    return {
      header: grp.header || " ",
      ...(grp.itemSize ? { itemSize: grp.itemSize } : {}),
      items: compiledItems,
    };
  });

  const runtimeConfig: any = {
    header: dryDoc.header || "",
    groups: compiledGroups,
    initData: dryDoc.initData || [],
  };

  if (dryDoc.rawMeta && Object.keys(dryDoc.rawMeta).length) {
    return {
      config: runtimeConfig,
      ...dryDoc.rawMeta,
    };
  }

  return {
    config: runtimeConfig,
  };
}
