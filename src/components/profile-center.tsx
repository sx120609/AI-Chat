"use client";

import { ArrowLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { DocumentTitle } from "@/components/document-title";
import { SiteConfirmDialog, SiteNoticeDialog } from "@/components/site-dialog";
import { SiteLogo } from "@/components/site-logo";
import {
  parsePersonalizationSettings,
  serializePersonalizationSettings,
  type PersonalizationLevel,
  type PersonalizationSettings
} from "@/lib/personalization";
import type {
  ChatModelView,
  SiteSettingsView,
  UsageSummary,
  UserApiKeyView,
  UserMemoryView,
  UserView
} from "@/types/gateway";

import type {
  ProfileTab,
  ApiKeysPayload,
  MemoriesPayload,
  SharedLinkView,
  SharedLinksPayload,
  ArchivedConversationView,
  ArchivedConversationsPayload,
  FileLibraryItem,
  FileLibraryPayload,
  UsageBreakdownPayload,
  UserProjectView,
  ProjectsPayload,
  DataControlAction,
  InstructionPreset
} from "./profile/types";

import { profileTabs } from "./profile/components";

import { OverviewTab } from "./profile/overview-tab";
import { SecurityTab } from "./profile/security-tab";
import { PersonalizationTab } from "./profile/personalization-tab";
import { MemoryTab } from "./profile/memory-tab";
import { DataTab } from "./profile/data-tab";
import { ApiTab } from "./profile/api-tab";

type ProfileCenterProps = {
  apiModels: ChatModelView[];
  initialUser: UserView;
  initialUsage: UsageSummary;
  siteSettings: SiteSettingsView;
};

export function ProfileCenter({
  apiModels,
  initialUser,
  initialUsage,
  siteSettings
}: ProfileCenterProps) {
  const [user, setUser] = useState(initialUser);
  const [name, setName] = useState(initialUser.name);
  const [personalization, setPersonalization] = useState<PersonalizationSettings>(() =>
    parsePersonalizationSettings(initialUser.aiStylePrompt)
  );
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [mobileProfileMenuOpen, setMobileProfileMenuOpen] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [apiKeyName, setApiKeyName] = useState("个人 API Key");
  const [apiKeys, setApiKeys] = useState<UserApiKeyView[]>([]);
  const [memories, setMemories] = useState<UserMemoryView[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<ArchivedConversationView[]>([]);
  const [sharedLinks, setSharedLinks] = useState<SharedLinkView[]>([]);
  const [fileLibrary, setFileLibrary] = useState<FileLibraryItem[]>([]);
  const [fileLibraryHasMore, setFileLibraryHasMore] = useState(false);
  const [fileLibraryTotal, setFileLibraryTotal] = useState(0);
  const [usageBreakdown, setUsageBreakdown] = useState<UsageBreakdownPayload | null>(null);
  const [projects, setProjects] = useState<UserProjectView[]>([]);
  const [fileProjectFilter, setFileProjectFilter] = useState("");
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [newMemoryProjectId, setNewMemoryProjectId] = useState("");
  const [canCreateApiKey, setCanCreateApiKey] = useState(user.userGroup === "VIP");
  const [origin, setOrigin] = useState("");
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null);
  const [deleteArchivedConversationTarget, setDeleteArchivedConversationTarget] =
    useState<ArchivedConversationView | null>(null);
  const [deleteMemoryId, setDeleteMemoryId] = useState<string | null>(null);
  const [clearMemoriesOpen, setClearMemoriesOpen] = useState(false);
  const [dataControlAction, setDataControlAction] = useState<DataControlAction | null>(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [showArchivedMemories, setShowArchivedMemories] = useState(false);
  const [apiGuideOpen, setApiGuideOpen] = useState(false);
  const [apiGuideKeyId, setApiGuideKeyId] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [loadingMemories, setLoadingMemories] = useState(true);
  const [loadingDataLists, setLoadingDataLists] = useState(true);
  const [loadingMoreFiles, setLoadingMoreFiles] = useState(false);
  const [savingKeyId, setSavingKeyId] = useState<string | null>(null);
  const [savingDataAction, setSavingDataAction] = useState(false);
  const [savingArchivedConversationId, setSavingArchivedConversationId] = useState<string | null>(null);
  const [savingFileId, setSavingFileId] = useState<string | null>(null);
  const [savingSharedLinkId, setSavingSharedLinkId] = useState<string | null>(null);
  const [savingMemory, setSavingMemory] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadApiKeys = useCallback(async () => {
    setLoadingKeys(true);
    const response = await fetch("/api/profile/api-keys");
    const payload = (await response.json().catch(() => null)) as
      | (ApiKeysPayload & { error?: string })
      | null;

    if (response.ok && payload) {
      setApiKeys(payload.keys);
      setCanCreateApiKey(payload.canCreate);
    } else {
      setError(payload?.error || "读取 API Key 失败。");
    }

    setLoadingKeys(false);
  }, []);

  const loadMemories = useCallback(async () => {
    setLoadingMemories(true);
    const response = await fetch("/api/profile/memories?includeArchived=1");
    const payload = (await response.json().catch(() => null)) as
      | (MemoriesPayload & { error?: string })
      | null;

    if (response.ok && payload) {
      setMemories(payload.memories);
    } else {
      setError(payload?.error || "读取记忆失败。");
    }

    setLoadingMemories(false);
  }, []);

  const loadDataLists = useCallback(async () => {
    setLoadingDataLists(true);
    const [archivedResponse, sharedResponse, fileResponse, usageResponse] = await Promise.all([
      fetch("/api/conversations?archived=1"),
      fetch("/api/profile/shared-links"),
      fetch("/api/profile/file-library?limit=100&offset=0"),
      fetch("/api/profile/usage")
    ]);
    const archivedPayload = (await archivedResponse.json().catch(() => null)) as
      | (ArchivedConversationsPayload & { error?: string })
      | null;
    const sharedPayload = (await sharedResponse.json().catch(() => null)) as
      | (SharedLinksPayload & { error?: string })
      | null;
    const filePayload = (await fileResponse.json().catch(() => null)) as
      | (FileLibraryPayload & { error?: string })
      | null;
    const usagePayload = (await usageResponse.json().catch(() => null)) as
      | (UsageBreakdownPayload & { error?: string })
      | null;

    if (archivedResponse.ok && archivedPayload) {
      setArchivedConversations(archivedPayload.conversations);
    } else {
      setError(archivedPayload?.error || "读取已归档聊天失败。");
    }

    if (sharedResponse.ok && sharedPayload) {
      setSharedLinks(sharedPayload.links);
    } else {
      setError(sharedPayload?.error || "读取共享链接失败。");
    }

    if (fileResponse.ok && filePayload) {
      setFileLibrary(filePayload.files);
      setFileLibraryHasMore(Boolean(filePayload.hasMore));
      setFileLibraryTotal(filePayload.total ?? filePayload.files.length);
    } else {
      setError(filePayload?.error || "读取文件库失败。");
    }

    if (usageResponse.ok && usagePayload) {
      setUsageBreakdown(usagePayload);
    } else {
      setError(usagePayload?.error || "读取用量明细失败。");
    }

    setLoadingDataLists(false);
  }, []);

  const loadMoreFiles = useCallback(async () => {
    if (loadingMoreFiles || !fileLibraryHasMore) {
      return;
    }

    setLoadingMoreFiles(true);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/file-library?limit=100&offset=${fileLibrary.length}`);
    const payload = (await response.json().catch(() => null)) as
      | (FileLibraryPayload & { error?: string })
      | null;

    if (!response.ok || !payload) {
      setError(payload?.error || "读取更多文件失败。");
    } else {
      setFileLibrary((current) => {
        const seen = new Set(current.map((file) => file.id));
        return [...current, ...payload.files.filter((file) => !seen.has(file.id))];
      });
      setFileLibraryHasMore(Boolean(payload.hasMore));
      setFileLibraryTotal(payload.total ?? fileLibraryTotal);
    }

    setLoadingMoreFiles(false);
  }, [fileLibrary.length, fileLibraryHasMore, fileLibraryTotal, loadingMoreFiles]);

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/profile/projects");
    const payload = (await response.json().catch(() => null)) as
      | (ProjectsPayload & { error?: string })
      | null;

    if (response.ok && payload) {
      setProjects(payload.projects);
    } else {
      setError(payload?.error || "读取项目偏好失败。");
    }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    void loadApiKeys();
    void loadDataLists();
    void loadMemories();
    void loadProjects();
  }, [
    loadApiKeys,
    loadDataLists,
    loadMemories,
    loadProjects
  ]);

  const revealableApiKeys = useMemo(() => apiKeys.filter((key) => key.apiKey), [apiKeys]);
  const selectedGuideApiKey = useMemo(
    () =>
      revealableApiKeys.find((key) => key.id === apiGuideKeyId) ??
      revealableApiKeys[0] ??
      null,
    [apiGuideKeyId, revealableApiKeys]
  );
  const activeMemories = useMemo(
    () => memories.filter((memory) => !memory.archivedAt),
    [memories]
  );
  const archivedMemories = useMemo(
    () => memories.filter((memory) => memory.archivedAt),
    [memories]
  );
  const visibleMemories = showArchivedMemories ? memories : activeMemories;
  const visibleFileLibrary = useMemo(
    () => {
      if (fileProjectFilter === "__account__") {
        return fileLibrary.filter((file) => !file.projectId);
      }

      return fileProjectFilter
        ? fileLibrary.filter((file) => file.projectId === fileProjectFilter)
        : fileLibrary;
    },
    [fileLibrary, fileProjectFilter]
  );

  const dataActionCopy: Record<DataControlAction, { confirmLabel: string; description: string; title: string }> = {
    archive_chats: {
      confirmLabel: "归档",
      description: "所有未归档聊天会从默认聊天列表中隐藏，但不会删除内容。",
      title: "归档所有聊天"
    },
    delete_chats: {
      confirmLabel: "清空",
      description: "所有聊天、消息和关联附件都会删除。这个操作无法撤销。",
      title: "清空所有聊天"
    },
    delete_account: {
      confirmLabel: "永久删除",
      description: "账号、聊天、记忆、API Key、任务、项目、通知、用量记录和上传文件都会永久删除。这个操作无法撤销。",
      title: "永久删除账号"
    },
    deactivate_account: {
      confirmLabel: "停用",
      description: "停用后这个账号不能继续使用，需要管理员重新启用。",
      title: "停用账号"
    },
    clear_shared_links: {
      confirmLabel: "全部失效",
      description: "所有已分享出去的会话链接都会立即失效。",
      title: "取消全部共享链接"
    }
  };

  const totalAvailableBaseline =
    initialUsage.monthlyCostLimitCents +
    initialUsage.aiPointsCostUsedCents +
    initialUsage.aiPointsBalanceCents;
  const lowBalanceWarning =
    totalAvailableBaseline > 0 &&
    initialUsage.remainingCostCents / totalAvailableBaseline <= 0.15;

  function openApiGuide(key?: UserApiKeyView) {
    setApiGuideKeyId(key?.apiKey ? key.id : revealableApiKeys[0]?.id ?? null);
    setApiGuideOpen(true);
    setError("");
  }

  function updatePersonalization(patch: Partial<PersonalizationSettings>) {
    setPersonalization((current) => {
      const next = {
        ...current,
        ...patch
      };

      if (!next.savedMemoryEnabled) {
        next.chatHistoryMemoryEnabled = false;
      }

      return next;
    });
  }

  function updateTrait(key: keyof PersonalizationSettings["traits"], value: PersonalizationLevel) {
    setPersonalization((current) => ({
      ...current,
      traits: {
        ...current.traits,
        [key]: value
      }
    }));
  }

  function updateAbout(key: keyof PersonalizationSettings["about"], value: string) {
    setPersonalization((current) => ({
      ...current,
      about: {
        ...current.about,
        [key]: value
      }
    }));
  }

  function updateToolPreference<Key extends keyof PersonalizationSettings["toolPreferences"]>(
    key: Key,
    value: PersonalizationSettings["toolPreferences"][Key]
  ) {
    setPersonalization((current) => ({
      ...current,
      toolPreferences: {
        ...current.toolPreferences,
        [key]: value
      }
    }));
  }

  function applyInstructionPreset(preset: InstructionPreset) {
    const presets: Record<
      InstructionPreset,
      Partial<
        Pick<
          PersonalizationSettings,
          "baseStyle" | "customInstructions" | "personality" | "quickAnswers"
        >
      >
    > = {
      concise: {
        baseStyle: "concise",
        customInstructions: "优先直接回答结论。除非我要求展开，否则只补充最关键的原因和下一步。",
        personality: "direct",
        quickAnswers: true
      },
      professional: {
        baseStyle: "balanced",
        customInstructions: "保持专业、准确和克制。遇到不确定信息时明确说明不确定性，并给出可验证路径。",
        personality: "professional",
        quickAnswers: true
      },
      teaching: {
        baseStyle: "detailed",
        customInstructions: "像老师一样分步骤解释。先给答案，再解释原理、常见误区和练习建议。",
        personality: "encouraging",
        quickAnswers: false
      },
      code: {
        baseStyle: "balanced",
        customInstructions: "回答代码问题时优先给可运行方案，说明改动点、边界条件和验证命令。",
        personality: "professional",
        quickAnswers: true
      },
      life: {
        baseStyle: "balanced",
        customInstructions: "回答日常问题时先帮我理清选择，再给实际可执行建议。语气自然、耐心一点。",
        personality: "friendly",
        quickAnswers: true
      }
    };

    updatePersonalization({
      customizationEnabled: true,
      ...presets[preset]
    });
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setNotice("");
    setError("");

    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        aiStylePrompt: serializePersonalizationSettings(personalization),
        name
      })
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; user?: UserView }
      | null;

    if (!response.ok || !payload?.user) {
      setError(payload?.error || "保存个人资料失败。");
    } else {
      setUser(payload.user);
      setPersonalization(parsePersonalizationSettings(payload.user.aiStylePrompt));
      setNotice("个人资料已保存。");
    }

    setSavingProfile(false);
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingPassword(true);
    setNotice("");
    setError("");

    const response = await fetch("/api/profile/password", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "修改密码失败。");
    } else {
      setCurrentPassword("");
      setNewPassword("");
      setNotice("密码已修改。");
    }

    setSavingPassword(false);
  }

  async function createApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingKey(true);
    setNotice("");
    setError("");

    const response = await fetch("/api/profile/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: apiKeyName })
    });
    const payload = (await response.json().catch(() => null)) as
      | { apiKey?: string; error?: string; key?: UserApiKeyView }
      | null;

    if (!response.ok || !payload?.apiKey || !payload.key) {
      setError(payload?.error || "创建 API Key 失败。");
    } else {
      setApiKeys((current) => [payload.key as UserApiKeyView, ...current]);
      setNotice("API Key 已创建。");
    }

    setCreatingKey(false);
  }

  async function updateApiKey(key: UserApiKeyView, patch: Partial<Pick<UserApiKeyView, "active" | "name">>) {
    setSavingKeyId(key.id);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/api-keys/${key.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; key?: UserApiKeyView }
      | null;

    if (!response.ok || !payload?.key) {
      setError(payload?.error || "更新 API Key 失败。");
    } else {
      setApiKeys((current) => current.map((item) => (item.id === key.id ? payload.key! : item)));
      setNotice("API Key 已更新。");
    }

    setSavingKeyId(null);
  }

  async function deleteApiKey() {
    if (!deleteKeyId) {
      return;
    }

    setSavingKeyId(deleteKeyId);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/api-keys/${deleteKeyId}`, {
      method: "DELETE"
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "删除 API Key 失败。");
    } else {
      setApiKeys((current) => current.filter((item) => item.id !== deleteKeyId));
      setNotice("API Key 已删除。");
    }

    setSavingKeyId(null);
    setDeleteKeyId(null);
  }

  async function createMemory() {
    const content = newMemoryContent.trim();

    if (!content) {
      setError("请输入要保存的记忆。");
      return;
    }

    setSavingMemory(true);
    setNotice("");
    setError("");

    const response = await fetch("/api/profile/memories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, projectId: newMemoryProjectId || null })
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; memory?: UserMemoryView }
      | null;

    if (!response.ok || !payload?.memory) {
      setError(payload?.error || "新增记忆失败。");
    } else {
      setMemories((current) => [
        payload.memory as UserMemoryView,
        ...current.filter((memory) => memory.id !== payload.memory?.id)
      ]);
      setNewMemoryContent("");
      setNotice("记忆已保存。");
    }

    setSavingMemory(false);
  }

  function startEditMemory(memory: UserMemoryView) {
    setEditingMemoryId(memory.id);
    setEditingMemoryContent(memory.content);
    setError("");
    setNotice("");
  }

  async function updateMemory(
    memory: UserMemoryView,
    patch: Partial<Pick<UserMemoryView, "content">> & { archived?: boolean }
  ) {
    setSavingMemory(true);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/memories/${memory.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; memory?: UserMemoryView }
      | null;

    if (!response.ok || !payload?.memory) {
      setError(payload?.error || "更新记忆失败。");
    } else {
      setMemories((current) =>
        current.map((item) => (item.id === payload.memory?.id ? payload.memory : item))
      );
      setNotice(patch.archived === true ? "记忆已归档。" : patch.archived === false ? "记忆已恢复。" : "记忆已更新。");
      setEditingMemoryId(null);
      setEditingMemoryContent("");
    }

    setSavingMemory(false);
  }

  async function saveMemoryEdit(memory: UserMemoryView) {
    const content = editingMemoryContent.trim();

    if (!content) {
      setError("记忆内容不能为空。");
      return;
    }

    await updateMemory(memory, { content });
  }

  async function deleteMemory() {
    if (!deleteMemoryId) {
      return;
    }

    setSavingMemory(true);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/memories/${deleteMemoryId}`, {
      method: "DELETE"
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "删除记忆失败。");
    } else {
      setMemories((current) => current.filter((memory) => memory.id !== deleteMemoryId));
      setNotice("记忆已删除。");
    }

    setSavingMemory(false);
    setDeleteMemoryId(null);
  }

  async function clearMemories() {
    setSavingMemory(true);
    setNotice("");
    setError("");

    const response = await fetch("/api/profile/memories", {
      method: "DELETE"
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "清空记忆失败。");
    } else {
      setMemories([]);
      setNotice("记忆已清空。");
    }

    setSavingMemory(false);
    setClearMemoriesOpen(false);
  }

  async function exportProfileData() {
    setNotice("");
    setError("");

    const response = await fetch("/api/profile/export");
    const payload = await response.text();

    if (!response.ok) {
      let errorPayload: { error?: string } = {};

      try {
        errorPayload = JSON.parse(payload || "{}") as { error?: string };
      } catch {
        errorPayload = {};
      }

      setError(errorPayload.error || "导出数据失败。");
      return;
    }

    downloadTextFile(`ai-chat-data-${new Date().toISOString().slice(0, 10)}.json`, payload);
    setNotice("数据导出已开始下载。");
  }

  async function exportUsageCsv() {
    setNotice("");
    setError("");

    const response = await fetch("/api/profile/usage?format=csv");
    const payload = await response.text();

    if (!response.ok) {
      setError("导出用量 CSV 失败。");
      return;
    }

    downloadTextFile(`usage-${new Date().toISOString().slice(0, 10)}.csv`, payload);
    setNotice("用量 CSV 已开始下载。");
  }

  async function runDataControlAction(action: DataControlAction) {
    setSavingDataAction(true);
    setNotice("");
    setError("");

    if (action === "clear_shared_links") {
      const response = await fetch("/api/profile/shared-links", { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as { deleted?: number; error?: string } | null;

      if (!response.ok) {
        setError(payload?.error || "取消共享链接失败。");
      } else {
        setSharedLinks([]);
        setNotice(`已取消 ${payload?.deleted ?? 0} 个共享链接。`);
      }
    } else {
      const response = await fetch("/api/profile/data-controls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = (await response.json().catch(() => null)) as
        | { affected?: number; error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error || "数据控制操作失败。");
      } else if (action === "archive_chats") {
        await loadDataLists();
        setNotice(`已归档 ${payload?.affected ?? 0} 个聊天。`);
      } else if (action === "delete_chats") {
        setNotice(`已清空 ${payload?.affected ?? 0} 个聊天。`);
        setArchivedConversations([]);
        setFileLibrary([]);
        setFileLibraryHasMore(false);
        setFileLibraryTotal(0);
        setSharedLinks([]);
      } else if (action === "delete_account") {
        setNotice("账号已删除。");
        window.location.href = "/login";
      } else {
        setNotice("账号已停用。");
        window.location.href = "/login";
      }
    }

    setSavingDataAction(false);
    setDataControlAction(null);
  }

  async function restoreArchivedConversation(conversationId: string) {
    setSavingArchivedConversationId(conversationId);
    setNotice("");
    setError("");

    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: false })
    });
    const payload = (await response.json().catch(() => null)) as
      | { conversation?: ArchivedConversationView; error?: string }
      | null;

    if (!response.ok || !payload?.conversation) {
      setError(payload?.error || "恢复归档聊天失败。");
    } else {
      setArchivedConversations((current) =>
        current.filter((conversation) => conversation.id !== conversationId)
      );
      setNotice("聊天已恢复到默认聊天列表。");
    }

    setSavingArchivedConversationId(null);
  }

  async function deleteArchivedConversation(conversationId: string) {
    setSavingArchivedConversationId(conversationId);
    setNotice("");
    setError("");

    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: "DELETE"
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "删除归档聊天失败。");
    } else {
      const removedFileCount = fileLibrary.filter((file) => file.conversationId === conversationId).length;

      setArchivedConversations((current) =>
        current.filter((conversation) => conversation.id !== conversationId)
      );
      setFileLibrary((current) => current.filter((file) => file.conversationId !== conversationId));
      setFileLibraryTotal((current) => Math.max(0, current - removedFileCount));
      setSharedLinks((current) => current.filter((link) => link.conversationId !== conversationId));
      setNotice("归档聊天已删除。");
    }

    setSavingArchivedConversationId(null);
    setDeleteArchivedConversationTarget(null);
  }

  async function deleteSharedLink(linkId: string) {
    setSavingSharedLinkId(linkId);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/shared-links/${linkId}`, {
      method: "DELETE"
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "取消共享链接失败。");
    } else {
      setSharedLinks((current) => current.filter((link) => link.id !== linkId));
      setNotice("共享链接已取消。");
    }

    setSavingSharedLinkId(null);
  }

  async function deleteFile(fileId: string) {
    setSavingFileId(fileId);
    setNotice("");
    setError("");

    const response = await fetch(`/api/profile/file-library/${fileId}`, {
      method: "DELETE"
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "删除文件失败。");
    } else {
      setFileLibrary((current) => current.filter((file) => file.id !== fileId));
      setFileLibraryTotal((current) => Math.max(0, current - 1));
      setNotice("文件已删除。");
    }

    setSavingFileId(null);
  }

  async function copyText(value: string, message = "已复制。") {
    if (!value) {
      return;
    }

    await navigator.clipboard?.writeText(value);
    setNotice(message);
    setError("");
  }

  async function copyApiKey(key: UserApiKeyView) {
    if (!key.apiKey) {
      setError("这个 Key 是旧版本创建的，无法查看明文。请重新创建一个。");
      return;
    }

    await copyText(key.apiKey, "API Key 已复制。");
  }

  function downloadTextFile(fileName: string, content: string) {
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice("配置文件已下载。");
    setError("");
  }

  const personalizationPayloadSize = serializePersonalizationSettings(personalization).length;
  const activeTabMeta = profileTabs.find((tab) => tab.id === activeTab) ?? profileTabs[0];
  const ActiveProfileTabIcon = activeTabMeta.icon;

  return (
    <main className="ios-page app-shell app-route-enter flex flex-col text-stone-950">
      <DocumentTitle title={`个人中心 - ${siteSettings.siteName}`} />
      <header className="app-header-center app-fade-in shrink-0 px-4 pb-2 pt-[calc(0.75rem+var(--app-safe-area-top,0px))] sm:px-6 sm:py-4">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <SiteLogo className="size-9 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[color:var(--claude-accent)]">
                {siteSettings.siteName}
              </p>
              <h1 className="truncate text-2xl font-bold leading-8">个人中心</h1>
            </div>
          </div>
          <Link
            className="ios-button-secondary app-action-button flex h-10 items-center gap-2 px-3 text-sm"
            href="/chat"
          >
            <ArrowLeft className="size-4" />
            返回聊天
          </Link>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pt-3">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          {lowBalanceWarning ? (
            <div className="app-inline-alert rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              可用额度较低，请留意本周期用量、充值 AI 点数或联系管理员调整额度。
            </div>
          ) : null}

          {mobileProfileMenuOpen ? (
            <section className="ios-panel motion-lift p-3 md:hidden" aria-label="个人中心二级菜单">
              <div className="mb-3">
                <h2 className="text-base font-semibold">设置分类</h2>
                <p className="mt-1 text-xs ios-muted">选择一个分类进入设置页。</p>
              </div>
              <div className="grid gap-2">
                {profileTabs.map((tab) => {
                  const TabIcon = tab.icon;

                  return (
                    <button
                      className="app-action-button flex min-h-16 items-center gap-3 rounded-lg border border-[color:var(--ios-separator)] bg-white/65 px-3 py-2 text-left transition hover:bg-white"
                      key={tab.id}
                      onClick={() => {
                        setActiveTab(tab.id);
                        setMobileProfileMenuOpen(false);
                      }}
                      type="button"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
                        <TabIcon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-stone-950">{tab.label}</span>
                        <span className="mt-0.5 block text-xs ios-muted">{tab.description}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-stone-400" />
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <nav className="ios-panel motion-lift hidden p-2 md:block" aria-label="个人中心设置分类">
            <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6" role="tablist">
              {profileTabs.map((tab) => {
                const TabIcon = tab.icon;
                const selected = activeTab === tab.id;

                return (
                  <button
                    aria-selected={selected}
                    className={`app-action-button flex min-h-14 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition ${
                      selected
                        ? "border border-white/70 bg-white text-stone-950 shadow-sm"
                        : "border border-transparent text-stone-600 hover:bg-white/60"
                    }`}
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    role="tab"
                    type="button"
                  >
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                        selected ? "bg-[color:var(--claude-accent)] text-white" : "bg-white/70"
                      }`}
                    >
                      <TabIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{tab.label}</span>
                      <span className="block truncate text-[11px] ios-muted">{tab.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          {!mobileProfileMenuOpen ? (
            <div className="ios-panel motion-lift flex items-center gap-3 p-3 md:hidden">
              <button
                className="app-action-button app-glass-control grid size-10 shrink-0 place-items-center rounded-lg text-stone-700"
                onClick={() => setMobileProfileMenuOpen(true)}
                title="返回设置分类"
                type="button"
              >
                <ArrowLeft className="size-4" />
              </button>
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
                <ActiveProfileTabIcon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-stone-950">{activeTabMeta.label}</p>
                <p className="truncate text-xs ios-muted">{activeTabMeta.description}</p>
              </div>
            </div>
          ) : null}

          <div className={mobileProfileMenuOpen ? "hidden md:block" : "block"}>
            {activeTab === "overview" && (
              <OverviewTab
                user={user}
                name={name}
                setName={setName}
                initialUsage={initialUsage}
                savingProfile={savingProfile}
                onSaveProfile={saveProfile}
              />
            )}

            {activeTab === "security" && (
              <SecurityTab
                currentPassword={currentPassword}
                setCurrentPassword={setCurrentPassword}
                newPassword={newPassword}
                setNewPassword={setNewPassword}
                savingPassword={savingPassword}
                onSavePassword={changePassword}
              />
            )}

            {activeTab === "personalization" && (
              <PersonalizationTab
                apiModels={apiModels}
                personalization={personalization}
                updatePersonalization={updatePersonalization}
                updateToolPreference={updateToolPreference}
                updateTrait={updateTrait}
                updateAbout={updateAbout}
                applyInstructionPreset={applyInstructionPreset}
                savingProfile={savingProfile}
                onSaveProfile={saveProfile}
                personalizationPayloadSize={personalizationPayloadSize}
              />
            )}

            {activeTab === "memory" && (
              <MemoryTab
                personalization={personalization}
                updatePersonalization={updatePersonalization}
                memories={memories}
                activeMemories={activeMemories}
                archivedMemories={archivedMemories}
                visibleMemories={visibleMemories}
                showArchivedMemories={showArchivedMemories}
                setShowArchivedMemories={setShowArchivedMemories}
                projects={projects}
                newMemoryProjectId={newMemoryProjectId}
                setNewMemoryProjectId={setNewMemoryProjectId}
                newMemoryContent={newMemoryContent}
                setNewMemoryContent={setNewMemoryContent}
                savingMemory={savingMemory}
                onCreateMemory={createMemory}
                loadingMemories={loadingMemories}
                editingMemoryId={editingMemoryId}
                setEditingMemoryId={setEditingMemoryId}
                editingMemoryContent={editingMemoryContent}
                setEditingMemoryContent={setEditingMemoryContent}
                onStartEditMemory={startEditMemory}
                onUpdateMemory={updateMemory}
                onSaveMemoryEdit={saveMemoryEdit}
                setDeleteMemoryId={setDeleteMemoryId}
                setClearMemoriesOpen={setClearMemoriesOpen}
                savingProfile={savingProfile}
                onSaveProfile={saveProfile}
                personalizationPayloadSize={personalizationPayloadSize}
              />
            )}

            {activeTab === "data" && (
              <DataTab
                loadingDataLists={loadingDataLists}
                onRefreshDataLists={loadDataLists}
                archivedConversations={archivedConversations}
                savingArchivedConversationId={savingArchivedConversationId}
                onRestoreArchivedConversation={restoreArchivedConversation}
                onSetDeleteArchivedConversationTarget={setDeleteArchivedConversationTarget}
                onExportProfileData={exportProfileData}
                onExportUsageCsv={exportUsageCsv}
                onSetDataControlAction={setDataControlAction}
                usageBreakdown={usageBreakdown}
                sharedLinks={sharedLinks}
                onCopyText={copyText}
                onDeleteSharedLink={deleteSharedLink}
                savingSharedLinkId={savingSharedLinkId}
                fileLibrary={fileLibrary}
                fileLibraryTotal={fileLibraryTotal}
                fileLibraryHasMore={fileLibraryHasMore}
                fileProjectFilter={fileProjectFilter}
                onSetFileProjectFilter={setFileProjectFilter}
                projects={projects}
                visibleFileLibrary={visibleFileLibrary}
                savingFileId={savingFileId}
                onDeleteFile={deleteFile}
                loadingMoreFiles={loadingMoreFiles}
                onLoadMoreFiles={loadMoreFiles}
                origin={origin}
              />
            )}

            {activeTab === "api" && (
              <ApiTab
                origin={origin}
                apiModels={apiModels}
                siteSettings={siteSettings}
                canCreateApiKey={canCreateApiKey}
                apiKeyName={apiKeyName}
                setApiKeyName={setApiKeyName}
                onCreateApiKey={createApiKey}
                loadingKeys={loadingKeys}
                apiKeys={apiKeys}
                onUpdateApiKey={updateApiKey}
                onCopyApiKey={copyApiKey}
                onSetDeleteKeyId={setDeleteKeyId}
                savingKeyId={savingKeyId}
                creatingKey={creatingKey}
                apiGuideOpen={apiGuideOpen}
                setApiGuideOpen={setApiGuideOpen}
                selectedGuideApiKey={selectedGuideApiKey}
                onOpenApiGuide={openApiGuide}
                onCopyText={copyText}
                onDownloadTextFile={downloadTextFile}
              />
            )}
          </div>
        </div>
      </div>

      <SiteConfirmDialog
        confirmLabel="删除"
        description="删除后使用这个 Key 的客户端会立即失效。"
        onCancel={() => setDeleteKeyId(null)}
        onConfirm={deleteApiKey}
        open={Boolean(deleteKeyId)}
        title="删除 API Key"
        tone="danger"
      />
      <SiteNoticeDialog
        description={error || notice}
        onClose={() => {
          setError("");
          setNotice("");
        }}
        open={Boolean(error || notice)}
        title={error ? "操作失败" : "操作已完成"}
        tone={error ? "error" : "success"}
      />
      <SiteConfirmDialog
        confirmLabel="删除"
        description={`确定删除「${deleteArchivedConversationTarget?.title || "这个归档聊天"}」吗？删除后聊天、消息和关联附件都会移除，此操作不可恢复。`}
        onCancel={() => setDeleteArchivedConversationTarget(null)}
        onConfirm={() => {
          if (deleteArchivedConversationTarget) {
            void deleteArchivedConversation(deleteArchivedConversationTarget.id);
          }
        }}
        open={Boolean(deleteArchivedConversationTarget)}
        title="删除归档聊天"
        tone="danger"
      />
      <SiteConfirmDialog
        confirmLabel="删除"
        description="删除后这条记忆不会再进入聊天上下文。"
        onCancel={() => setDeleteMemoryId(null)}
        onConfirm={deleteMemory}
        open={Boolean(deleteMemoryId)}
        title="删除记忆"
        tone="danger"
      />
      <SiteConfirmDialog
        confirmLabel="清空"
        description="清空后所有保存的记忆都会删除，不会再进入聊天上下文。"
        onCancel={() => setClearMemoriesOpen(false)}
        onConfirm={clearMemories}
        open={clearMemoriesOpen}
        title="清空全部记忆"
        tone="danger"
      />
      <SiteConfirmDialog
        confirmLabel={
          dataControlAction
            ? savingDataAction
              ? "处理中..."
              : dataActionCopy[dataControlAction].confirmLabel
            : "确认"
        }
        description={dataControlAction ? dataActionCopy[dataControlAction].description : ""}
        onCancel={() => setDataControlAction(null)}
        onConfirm={() => {
          if (dataControlAction) {
            void runDataControlAction(dataControlAction);
          }
        }}
        open={Boolean(dataControlAction)}
        title={dataControlAction ? dataActionCopy[dataControlAction].title : "确认操作"}
        tone="danger"
      />
    </main>
  );
}
