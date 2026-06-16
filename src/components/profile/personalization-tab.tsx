import { FormEvent } from "react";
import { Sparkles, Loader2, Save } from "lucide-react";
import { PersonalizationSettings, PersonalizationLevel } from "@/lib/personalization";
import { REASONING_EFFORTS } from "@/lib/models";
import type { ChatModelView } from "@/types/gateway";
import {
  BASE_STYLE_OPTIONS,
  PERSONALITY_OPTIONS,
  LEVEL_OPTIONS,
  INSTRUCTION_PRESETS,
  PreferenceSelect,
  ToggleRow
} from "./components";
import { InstructionPreset } from "./types";

type PersonalizationTabProps = {
  apiModels: ChatModelView[];
  personalization: PersonalizationSettings;
  updatePersonalization: (patch: Partial<PersonalizationSettings>) => void;
  updateToolPreference: <Key extends keyof PersonalizationSettings["toolPreferences"]>(
    key: Key,
    value: PersonalizationSettings["toolPreferences"][Key]
  ) => void;
  updateTrait: (key: keyof PersonalizationSettings["traits"], value: PersonalizationLevel) => void;
  updateAbout: (key: keyof PersonalizationSettings["about"], value: string) => void;
  applyInstructionPreset: (preset: InstructionPreset) => void;
  savingProfile: boolean;
  onSaveProfile: (event: FormEvent<HTMLFormElement>) => void;
  personalizationPayloadSize: number;
};

export function PersonalizationTab({
  apiModels,
  personalization,
  updatePersonalization,
  updateToolPreference,
  updateTrait,
  updateAbout,
  applyInstructionPreset,
  savingProfile,
  onSaveProfile,
  personalizationPayloadSize
}: PersonalizationTabProps) {
  const selectedDefaultModel = personalization.toolPreferences.defaultModel;
  const defaultModelIsAvailable =
    !selectedDefaultModel ||
    apiModels.some((model) => model.id === selectedDefaultModel || model.upstreamId === selectedDefaultModel);
  const defaultModelOptions = [
    { label: "跟随系统默认", value: "" },
    ...apiModels.map((model) => ({ label: model.label, value: model.id })),
    ...(defaultModelIsAvailable
      ? []
      : [{ label: `已保存：${selectedDefaultModel}`, value: selectedDefaultModel }])
  ];
  const reasoningOptions = REASONING_EFFORTS.map((item) => ({
    label: item.label,
    value: item.id
  }));
  const securityMode = personalization.toolPreferences.securityMode;

  return (
    <form className="ios-panel motion-lift overflow-hidden" onSubmit={onSaveProfile}>
      <div className="flex items-center gap-2 border-b border-[color:var(--ios-separator)] px-4 py-4">
        <Sparkles className="size-4 text-[color:var(--claude-accent)]" />
        <h2 className="text-base font-semibold">个性化</h2>
      </div>

      <div className="divide-y divide-[color:var(--ios-separator)]">
        <ToggleRow
          checked={personalization.customizationEnabled}
          description="关闭后不会把自定义指令、关于你和人格风格写入系统提示词。"
          label="启用自定义指令"
          onChange={(checked) => updatePersonalization({ customizationEnabled: checked })}
        />

        <div className="px-4 py-4">
          <p className="text-sm font-semibold text-stone-950">预设模板</p>
          <p className="mt-1 text-sm leading-5 ios-muted">快速套用一组常用回答偏好，之后仍可继续微调。</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {INSTRUCTION_PRESETS.map((preset) => (
              <button
                className="app-action-button rounded-lg border border-[color:var(--ios-separator)] bg-white/60 px-3 py-2 text-left transition hover:bg-white"
                key={preset.id}
                onClick={() => applyInstructionPreset(preset.id)}
                type="button"
              >
                <span className="block text-sm font-semibold text-stone-950">{preset.label}</span>
                <span className="mt-1 block text-xs leading-5 ios-muted">{preset.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <p className="text-sm font-semibold text-stone-950">基本风格和语调</p>
            <p className="mt-1 text-sm leading-5 ios-muted">设置 AI 回复你的风格 and 语调。</p>
          </div>
          <PreferenceSelect
            ariaLabel="基本风格和语调"
            onChange={(value) => updatePersonalization({ baseStyle: value })}
            options={BASE_STYLE_OPTIONS}
            value={personalization.baseStyle}
          />
        </div>

        <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <p className="text-sm font-semibold text-stone-950">人格</p>
            <p className="mt-1 text-sm leading-5 ios-muted">选择默认、友好、直接、鼓励型或专业型的回答气质。</p>
          </div>
          <PreferenceSelect
            ariaLabel="人格"
            onChange={(value) => updatePersonalization({ personality: value })}
            options={PERSONALITY_OPTIONS}
            value={personalization.personality}
          />
        </div>

        <div className="px-4 py-4">
          <p className="text-sm font-semibold text-stone-950">特征</p>
          <p className="mt-1 text-sm leading-5 ios-muted">在基本风格和语调的基础上选择额外的自定义项。</p>
          <div className="mt-3 grid gap-2">
            <PreferenceSelect
              label="温和体贴"
              onChange={(value) => updateTrait("warmth", value)}
              options={LEVEL_OPTIONS}
              value={personalization.traits.warmth}
            />
            <PreferenceSelect
              label="热情洋溢"
              onChange={(value) => updateTrait("enthusiasm", value)}
              options={LEVEL_OPTIONS}
              value={personalization.traits.enthusiasm}
            />
            <PreferenceSelect
              label="标题和列表"
              onChange={(value) => updateTrait("structure", value)}
              options={LEVEL_OPTIONS}
              value={personalization.traits.structure}
            />
            <PreferenceSelect
              label="表情符号"
              onChange={(value) => updateTrait("emoji", value)}
              options={LEVEL_OPTIONS}
              value={personalization.traits.emoji}
            />
          </div>
        </div>

        <ToggleRow
          checked={personalization.quickAnswers}
          description="写入聊天提示词：先给直接答案，再根据问题补充必要细节。"
          label="快速回答"
          onChange={(checked) => updatePersonalization({ quickAnswers: checked })}
        />

        <div className="px-4 py-4">
          <p className="text-sm font-semibold text-stone-950">工具默认值</p>
          <p className="mt-1 text-sm leading-5 ios-muted">
            控制新聊天和每次发送后恢复到的默认工具状态。
          </p>
        </div>

        <ToggleRow
          checked={personalization.toolPreferences.webSearchDefault}
          description={
            securityMode
              ? "安全模式开启时不会默认联网；关闭安全模式后此偏好会继续生效。"
              : "开启后，新聊天和每次发送后都会默认打开下一条联网搜索。"
          }
          disabled={securityMode}
          label="默认联网搜索"
          onChange={(checked) => updateToolPreference("webSearchDefault", checked)}
        />
        <ToggleRow
          checked={personalization.toolPreferences.imageGenerationEnabled}
          description="关闭后，聊天页不会启用 image2 生图或图片编辑入口。"
          disabled={securityMode}
          label="允许生图和图片编辑"
          onChange={(checked) => updateToolPreference("imageGenerationEnabled", checked)}
        />
        <ToggleRow
          checked={personalization.toolPreferences.fileAnalysisEnabled}
          description="关闭后，聊天页不会允许上传附件做分析。"
          disabled={securityMode}
          label="允许附件分析"
          onChange={(checked) => updateToolPreference("fileAnalysisEnabled", checked)}
        />
        <ToggleRow
          checked={securityMode}
          description="开启后默认临时聊天，并禁用联网搜索、生图和附件分析。"
          label="安全模式"
          onChange={(checked) => updateToolPreference("securityMode", checked)}
        />

        <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <p className="text-sm font-semibold text-stone-950">默认聊天模型</p>
            <p className="mt-1 text-sm leading-5 ios-muted">新聊天默认选择的模型。</p>
          </div>
          <PreferenceSelect
            ariaLabel="默认聊天模型"
            onChange={(value) => updateToolPreference("defaultModel", value)}
            options={defaultModelOptions}
            value={selectedDefaultModel}
          />
        </div>

        <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <p className="text-sm font-semibold text-stone-950">默认思考强度</p>
            <p className="mt-1 text-sm leading-5 ios-muted">用于支持 reasoning 的模型。</p>
          </div>
          <PreferenceSelect
            ariaLabel="默认思考强度"
            onChange={(value) => updateToolPreference("defaultReasoningEffort", value)}
            options={reasoningOptions}
            value={personalization.toolPreferences.defaultReasoningEffort}
          />
        </div>

        <div className="grid gap-2 px-4 py-4">
          <label className="text-sm font-semibold text-stone-950" htmlFor="custom-instructions">
            你希望 AI 如何回答？
          </label>
          <textarea
            className="ios-input min-h-20 w-full resize-y py-3 text-sm leading-6"
            id="custom-instructions"
            maxLength={900}
            onChange={(event) => updatePersonalization({ customInstructions: event.target.value })}
            placeholder="例如：先给结论；代码问题给验证命令；不确定时直接说明"
            value={personalization.customInstructions}
          />
        </div>

        <div className="px-4 py-4">
          <h3 className="text-sm font-semibold text-stone-950">你希望 AI 了解你什么？</h3>
          <p className="mt-1 text-sm leading-5 ios-muted">这些内容会作为稳定个人信息进入提示词，不等同于自动新增记忆。</p>
        </div>

        <div className="grid gap-4 px-4 py-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-stone-950">昵称</span>
            <input
              className="ios-input w-full"
              maxLength={80}
              onChange={(event) => updateAbout("nickname", event.target.value)}
              placeholder="AI 应该怎么称呼你？"
              value={personalization.about.nickname}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-stone-950">职业</span>
            <input
              className="ios-input w-full"
              maxLength={120}
              onChange={(event) => updateAbout("occupation", event.target.value)}
              placeholder="家庭主妇、产品经理、开发者..."
              value={personalization.about.occupation}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-stone-950">你的详情</span>
            <textarea
              className="ios-input min-h-20 w-full resize-y py-3 text-sm leading-6"
              maxLength={900}
              onChange={(event) => updateAbout("details", event.target.value)}
              placeholder="需要记住的兴趣、价值观或偏好"
              value={personalization.about.details}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <p className="text-xs ios-muted">{personalizationPayloadSize}/8000</p>
          <button
            className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
            disabled={savingProfile}
            type="submit"
          >
            {savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存个性化
          </button>
        </div>
      </div>
    </form>
  );
}
