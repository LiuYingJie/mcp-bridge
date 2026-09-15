import { ExcelFeature } from "./excel/ExcelFeature";

export interface FeatureToolDefinition {
	name: string;
	description: string;
	inputSchema: any;
	run: (args: any) => Promise<any>;
}

interface LocalFeature {
	id: string;
	title: string;
	tools: FeatureToolDefinition[];
}

/**
 * 本地日常工具的统一注册表。
 *
 * 这些功能和 Cocos 编辑器工具共用同一个 MCP 服务；新增 feature 不需要再为
 * Codex/Cursor 写入新的 MCP 配置。`call_local_feature` 的 arguments 是动态工具
 * 参数，其准确类型由 get_local_feature_tools 返回的 inputSchema 决定。
 */
export class FeatureRegistry {
	private static readonly features: LocalFeature[] = [ExcelFeature];

	/** 返回可直接暴露给 MCP 客户端的本地工具定义。 */
	static getTools(): FeatureToolDefinition[] {
		return this.features.reduce((tools, feature) => tools.concat(feature.tools), [] as FeatureToolDefinition[]);
	}

	/** 返回功能和工具清单，供客户端在不重连 MCP 的情况下发现新增能力。 */
	static getSummary() {
		return this.features.map((feature) => ({
			id: feature.id,
			title: feature.title,
			tools: feature.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
		}));
	}

	/** 按公开工具名执行本地 feature 工具。 */
	static async execute(toolName: string, args: any) {
		const tool = this.getTools().find((item) => item.name === toolName);
		if (!tool) {
			throw new Error(`未找到本地工具: ${toolName}`);
		}
		return tool.run(args || {});
	}

	/** 判断工具是否由本地 feature 提供。 */
	static hasTool(toolName: string): boolean {
		return this.getTools().some((item) => item.name === toolName);
	}
}
