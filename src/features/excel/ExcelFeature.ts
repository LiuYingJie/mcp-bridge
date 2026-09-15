import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as ExcelJS from "exceljs";
import type { FeatureToolDefinition } from "../FeatureRegistry";

const CONFIG_LAYOUT = { headerRow: 2, dataStartRow: 5, metaEndRow: 4 };
const PLAIN_LAYOUT = { headerRow: 1, dataStartRow: 2, metaEndRow: 1 };

/** 获取 537 配置表或普通表的行布局。 */
function resolveLayout(layout = "config") {
	return ["config", "cfg", "537"].indexOf(String(layout).toLowerCase()) >= 0 ? CONFIG_LAYOUT : PLAIN_LAYOUT;
}

/** 解析并限制工作簿路径，避免 ExcelJS 写回含宏文件。 */
function resolveWorkbookPath(filePath: string, writable = false): string {
	if (!filePath || typeof filePath !== "string") throw new Error("path 必须是 .xlsx 文件路径");
	const resolved = path.resolve(filePath);
	const ext = path.extname(resolved).toLowerCase();
	if (ext !== ".xlsx") {
		const action = writable ? "写入" : "读取";
		throw new Error(`${action}仅支持 .xlsx；.xlsm 宏工作簿不能由 ExcelJS 安全保存`);
	}
	if (!fs.existsSync(resolved)) throw new Error(`文件不存在: ${resolved}`);
	return resolved;
}

/** 将 ExcelJS 单元格值转换为可 JSON 传输的值。 */
function toJsonValue(value: any): any {
	if (value instanceof Date) return value.toISOString();
	if (value && typeof value === "object") {
		if (Array.isArray(value)) return value.map(toJsonValue);
		const result: any = {};
		Object.keys(value).forEach((key) => (result[key] = toJsonValue(value[key])));
		return result;
	}
	return value;
}

/** 数组和对象在配置表里按 JSON 文本写入，其他原始类型保持不变。 */
function toCellValue(value: any): any {
	if (Array.isArray(value) || (value && typeof value === "object" && !(value instanceof Date))) {
		return JSON.stringify(value);
	}
	return value === undefined ? null : value;
}

/** 取得指定或活动工作表。 */
function getSheet(workbook: ExcelJS.Workbook, sheet?: string): ExcelJS.Worksheet {
	const target = sheet ? workbook.getWorksheet(sheet) : workbook.worksheets[0];
	if (!target) throw new Error(sheet ? `工作表不存在: ${sheet}` : "工作簿没有工作表");
	return target;
}

/** 读取表头，空列使用 col_N 占位。 */
function getHeaders(sheet: ExcelJS.Worksheet, headerRow: number): string[] {
	const row = sheet.getRow(headerRow);
	const headers: string[] = [];
	for (let col = 1; col <= sheet.columnCount; col++) {
		const raw = row.getCell(col).value;
		headers.push(raw === null || raw === undefined || String(raw).trim() === "" ? `col_${col}` : String(raw).trim());
	}
	while (headers.length && headers[headers.length - 1].startsWith("col_")) headers.pop();
	return headers;
}

/** 将列名、Excel 列字母或从 1 开始的列号解析成数字下标。 */
function getColumnIndex(column: any, headers: string[]): number {
	if (typeof column === "number" && Number.isInteger(column) && column > 0) return column;
	const text = String(column || "").trim();
	const headerIndex = headers.indexOf(text);
	if (headerIndex >= 0) return headerIndex + 1;
	if (/^\d+$/.test(text)) return Number(text);
	if (/^[A-Za-z]+$/.test(text)) {
		return text.toUpperCase().split("").reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
	}
	throw new Error(`无法解析列: ${column}`);
}

/** 读取工作簿并确保异步操作结束后释放引用。 */
async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.readFile(filePath);
	return workbook;
}

/** 对工作簿执行写入，并以同一路径原子替换，降低意外中断时损坏源文件的风险。 */
async function writeWorkbook(workbook: ExcelJS.Workbook, filePath: string) {
	const tempPath = `${filePath}.mcp-writing`;
	await workbook.xlsx.writeFile(tempPath);
	fs.renameSync(tempPath, filePath);
}

/** 读取任意 Excel 区域。 */
async function readRange(args: any) {
	const filePath = resolveWorkbookPath(args.path);
	const workbook = await loadWorkbook(filePath);
	const sheet = getSheet(workbook, args.sheet);
	// ExcelJS 没有 Range 对象；使用 A1:B2 拆分为起止坐标。
	const parts = String(args.range_addr).toUpperCase().split(":");
	const start = sheet.getCell(parts[0]);
	const end = sheet.getCell(parts[1] || parts[0]);
	const minRow = Math.min(Number(start.row), Number(end.row));
	const maxRow = Math.max(Number(start.row), Number(end.row));
	const minCol = Math.min(Number(start.col), Number(end.col));
	const maxCol = Math.max(Number(start.col), Number(end.col));
	const cells: any[] = [];
	const matrix: any[][] = [];
	for (let row = minRow; row <= maxRow; row++) {
		const values: any[] = [];
		for (let col = minCol; col <= maxCol; col++) {
			const cell = sheet.getCell(row, col);
			const value = toJsonValue(cell.value);
			values.push(value);
			cells.push({ address: cell.address, value, formula: cell.formula || null });
		}
		matrix.push(values);
	}
	return { path: filePath, sheet: sheet.name, range: String(args.range_addr).toUpperCase(), matrix, cells };
}

/** 批量写入时的单项处理。 */
function applyUpdate(sheet: ExcelJS.Worksheet, update: any, headers: string[]) {
	if (!update || typeof update !== "object") throw new Error("updates 中每项必须是对象");
	if (update.cell) {
		const cell = sheet.getCell(String(update.cell));
		const old = toJsonValue(cell.value);
		cell.value = toCellValue(update.value);
		return { cell: cell.address, old, new: toJsonValue(cell.value) };
	}
	const rowNumber = Number(update.row);
	if (!Number.isInteger(rowNumber) || rowNumber < 1) throw new Error("update.row 必须是从 1 开始的行号");
	if (update.values) {
		const changes: any[] = [];
		Object.keys(update.values).forEach((field) => {
			const col = getColumnIndex(field, headers);
			const cell = sheet.getCell(rowNumber, col);
			const old = toJsonValue(cell.value);
			cell.value = toCellValue(update.values[field]);
			changes.push({ cell: cell.address, field, old, new: toJsonValue(cell.value) });
		});
		return { row: rowNumber, changes };
	}
	if (update.col !== undefined || update.column !== undefined) {
		const cell = sheet.getCell(rowNumber, getColumnIndex(update.col === undefined ? update.column : update.col, headers));
		const old = toJsonValue(cell.value);
		cell.value = toCellValue(update.value);
		return { cell: cell.address, old, new: toJsonValue(cell.value) };
	}
	throw new Error("更新项必须包含 cell、values 或 col/value");
}

/** 读取配置表基础结构并校验元信息。 */
async function validateConfig(args: any) {
	const filePath = resolveWorkbookPath(args.path);
	const workbook = await loadWorkbook(filePath);
	const sheets = args.sheet ? [getSheet(workbook, args.sheet)] : workbook.worksheets;
	const validTypes = new Set(["Null", "KeyNumber", "Number", "NumberOrNull", "KeyString", "String", "StringOrNull", "List", "ListOrNull", "StringList", "StringListOrNull", "Map", "MapOrNull", "Native", "[Num,*]", "[[Num,*]]", "[String,*]"]);
	const results = sheets.map((sheet) => {
		const headers = getHeaders(sheet, CONFIG_LAYOUT.headerRow);
		const errors: any[] = [];
		if (!headers.length) errors.push({ row: 2, message: "字段行为空" });
		headers.forEach((field, index) => {
			const rawType = sheet.getCell(3, index + 1).value;
			const type = String(rawType || "").replace(/，/g, ",");
			if (type && !validTypes.has(type)) errors.push({ cell: sheet.getCell(3, index + 1).address, message: `未知字段类型: ${type}` });
		});
		return { sheet: sheet.name, ok: errors.length === 0, headers, errors };
	});
	return { path: filePath, ok: results.every((item) => item.ok), sheets: results };
}

/** 运行客户端配置导出脚本。 */
function exportClientConfig(args: any): Promise<any> {
	const editorProjectPath = (global as any).Editor && (global as any).Editor.Project && (global as any).Editor.Project.path;
	const defaultConfigDir = editorProjectPath ? path.resolve(editorProjectPath, "..", "Config") : path.resolve(process.cwd(), "..", "Config");
	const configDir = path.resolve(args.config_dir || defaultConfigDir);
	const batchFile = path.join(configDir, "A_client.bat");
	if (!fs.existsSync(batchFile)) return Promise.reject(new Error(`未找到配置导出脚本: ${batchFile}`));
	const timeoutSec = Number(args.timeout_sec || 300);
	return new Promise((resolve, reject) => {
		const child = childProcess.spawn("cmd.exe", ["/c", batchFile], { cwd: configDir, windowsHide: true });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => child.kill(), timeoutSec * 1000);
		child.stdout.on("data", (data) => (stdout += data.toString()));
		child.stderr.on("data", (data) => (stderr += data.toString()));
		child.on("error", reject);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ ok: code === 0, config_dir: configDir, command: batchFile, returncode: code, stdout_tail: stdout.split(/\r?\n/).slice(-80).join("\n"), stderr_tail: stderr.split(/\r?\n/).slice(-40).join("\n") });
		});
	});
}

const simpleObjectSchema = { type: "object", properties: {} };
const pathSchema = { type: "string", description: "绝对或当前工作目录相对的 .xlsx 文件路径" };

/** Excel 本地 feature：与 Cocos MCP 共用同一服务，不再需要 Python MCP。 */
export const ExcelFeature = {
	id: "excel",
	title: "Excel 工作簿",
	tools: [] as FeatureToolDefinition[],
};

ExcelFeature.tools.push(
	{
		name: "excel_list_sheets", description: "列出 .xlsx 工作簿中的工作表。", inputSchema: { type: "object", properties: { path: pathSchema }, required: ["path"] },
		run: async (args) => { const filePath = resolveWorkbookPath(args.path); const workbook = await loadWorkbook(filePath); return { path: filePath, sheets: workbook.worksheets.map((sheet) => sheet.name) }; },
	},
	{
		name: "excel_get_headers", description: "读取表头。layout=config 读第2行；plain 读第1行。", inputSchema: { type: "object", properties: { path: pathSchema, sheet: { type: "string" }, layout: { type: "string", enum: ["config", "plain"] } }, required: ["path"] },
		run: async (args) => { const filePath = resolveWorkbookPath(args.path); const workbook = await loadWorkbook(filePath); const sheet = getSheet(workbook, args.sheet); const layout = resolveLayout(args.layout); return { path: filePath, sheet: sheet.name, layout: args.layout || "config", headers: getHeaders(sheet, layout.headerRow) }; },
	},
	{
		name: "excel_read_rows", description: "按行读取数据。537 配置表默认从第5行开始。", inputSchema: { type: "object", properties: { path: pathSchema, sheet: { type: "string" }, layout: { type: "string", enum: ["config", "plain"] }, start_row: { type: "number" }, limit: { type: "number" }, as_dict: { type: "boolean" } }, required: ["path"] },
		run: async (args) => { const filePath = resolveWorkbookPath(args.path); const workbook = await loadWorkbook(filePath); const sheet = getSheet(workbook, args.sheet); const layout = resolveLayout(args.layout); const headers = getHeaders(sheet, layout.headerRow); const start = Number(args.start_row || layout.dataStartRow); const limit = Math.min(Math.max(Number(args.limit || 100), 1), 1000); const rows: any[] = []; for (let row = start; row <= Math.min(sheet.rowCount, start + limit - 1); row++) { const values = headers.map((_, col) => toJsonValue(sheet.getCell(row, col + 1).value)); rows.push(args.as_dict === false ? values : headers.reduce((obj: any, key, i) => { obj[key] = values[i]; return obj; }, { row })); } return { path: filePath, sheet: sheet.name, layout: args.layout || "config", start_row: start, rows }; },
	},
	{ name: "excel_read_range", description: "读取任意区域，例如 A1:D10，返回 matrix 和单元格明细。", inputSchema: { type: "object", properties: { path: pathSchema, range_addr: { type: "string" }, sheet: { type: "string" } }, required: ["path", "range_addr"] }, run: readRange },
	{
		name: "excel_write_cell", description: "写入单个单元格。写操作仅支持 .xlsx。", inputSchema: { type: "object", properties: { path: pathSchema, cell: { type: "string" }, value: {}, sheet: { type: "string" } }, required: ["path", "cell", "value"] },
		run: async (args) => { const filePath = resolveWorkbookPath(args.path, true); const workbook = await loadWorkbook(filePath); const sheet = getSheet(workbook, args.sheet); const cell = sheet.getCell(args.cell); const old = toJsonValue(cell.value); cell.value = toCellValue(args.value); await writeWorkbook(workbook, filePath); return { path: filePath, sheet: sheet.name, cell: cell.address, old, new: toJsonValue(cell.value) }; },
	},
	{
		name: "excel_write_range", description: "从 start_cell 开始按二维矩阵批量写入。", inputSchema: { type: "object", properties: { path: pathSchema, start_cell: { type: "string" }, values: { type: "array", items: { type: "array", items: {} } }, sheet: { type: "string" } }, required: ["path", "start_cell", "values"] },
		run: async (args) => { if (!Array.isArray(args.values) || !args.values.length) throw new Error("values 必须是非空二维数组"); const filePath = resolveWorkbookPath(args.path, true); const workbook = await loadWorkbook(filePath); const sheet = getSheet(workbook, args.sheet); const start = sheet.getCell(args.start_cell); args.values.forEach((row: any[], rowOffset: number) => { if (!Array.isArray(row)) throw new Error("values 必须是二维数组"); row.forEach((value, colOffset) => sheet.getCell(start.row + rowOffset, start.col + colOffset).value = toCellValue(value)); }); await writeWorkbook(workbook, filePath); return { path: filePath, sheet: sheet.name, start_cell: start.address, written_rows: args.values.length }; },
	},
	{
		name: "excel_batch_update", description: "按单元格或行字段批量更新。dry_run=true 只返回差异。", inputSchema: { type: "object", properties: { path: pathSchema, updates: { type: "array", items: { type: "object" } }, sheet: { type: "string" }, layout: { type: "string", enum: ["config", "plain"] }, dry_run: { type: "boolean" } }, required: ["path", "updates"] },
		run: async (args) => { if (!Array.isArray(args.updates) || !args.updates.length) throw new Error("updates 不能为空"); const filePath = resolveWorkbookPath(args.path, !args.dry_run); const workbook = await loadWorkbook(filePath); const sheet = getSheet(workbook, args.sheet); const headers = getHeaders(sheet, resolveLayout(args.layout).headerRow); const changes = args.updates.map((item) => applyUpdate(sheet, item, headers)); if (!args.dry_run) await writeWorkbook(workbook, filePath); return { path: filePath, sheet: sheet.name, dry_run: !!args.dry_run, changed: changes.length, changes }; },
	},
	{
		name: "excel_append_rows", description: "按字段字典追加数据行。", inputSchema: { type: "object", properties: { path: pathSchema, rows: { type: "array", items: { type: "object" } }, sheet: { type: "string" }, layout: { type: "string", enum: ["config", "plain"] } }, required: ["path", "rows"] },
		run: async (args) => { if (!Array.isArray(args.rows) || !args.rows.length) throw new Error("rows 不能为空"); const filePath = resolveWorkbookPath(args.path, true); const workbook = await loadWorkbook(filePath); const sheet = getSheet(workbook, args.sheet); const headers = getHeaders(sheet, resolveLayout(args.layout).headerRow); args.rows.forEach((data) => { const row = sheet.addRow(headers.map((header) => toCellValue(data[header]))); }); await writeWorkbook(workbook, filePath); return { path: filePath, sheet: sheet.name, appended: args.rows.length }; },
	},
	{
		name: "excel_backup_workbook", description: "备份工作簿到同级 .mcp_backups 目录或指定目录。", inputSchema: { type: "object", properties: { path: pathSchema, backup_dir: { type: "string" } }, required: ["path"] },
		run: async (args) => { const filePath = resolveWorkbookPath(args.path); const dir = path.resolve(args.backup_dir || path.join(path.dirname(filePath), ".mcp_backups")); fs.mkdirSync(dir, { recursive: true }); const backup = path.join(dir, `${path.basename(filePath, ".xlsx")}_${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`); fs.copyFileSync(filePath, backup); return { path: filePath, backup }; },
	},
	{ name: "excel_validate_config", description: "校验 537 配置表的字段行和类型行。", inputSchema: { type: "object", properties: { path: pathSchema, sheet: { type: "string" } }, required: ["path"] }, run: validateConfig },
	{ name: "excel_export_client_config", description: "运行配置目录中的 A_client.bat 导出客户端配置。", inputSchema: { type: "object", properties: { config_dir: { type: "string" }, timeout_sec: { type: "number" } } }, run: exportClientConfig },
);
