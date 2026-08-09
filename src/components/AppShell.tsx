import { useLayoutEffect, useRef, useState } from "react";
import { RotateCwIcon, SearchIcon, SettingsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const secondaryButtonProps = {
  variant: "outline" as const,
  size: "lg" as const
};

export function AppShell() {
  const [outputMode, setOutputMode] = useState("transcript");
  const [settingsSection, setSettingsSection] = useState("prompts");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);

  useLayoutEffect(() => {
    const syncOutputMode = (event: Event) => {
      const mode = (event as CustomEvent<string>).detail;
      if (isOutputMode(mode)) setOutputMode(mode);
    };
    const syncSettingsSection = (event: Event) => {
      const section = (event as CustomEvent<string>).detail;
      if (isSettingsSection(section)) setSettingsSection(section);
    };
    const syncSettingsDialog = (event: Event) => setSettingsOpen((event as CustomEvent<boolean>).detail);
    const syncFollowUpDialog = (event: Event) => setFollowUpOpen((event as CustomEvent<boolean>).detail);

    document.addEventListener("ui:output-mode-request", syncOutputMode);
    document.addEventListener("ui:settings-section-request", syncSettingsSection);
    document.addEventListener("ui:settings-dialog-request", syncSettingsDialog);
    document.addEventListener("ui:follow-up-dialog-request", syncFollowUpDialog);
    return () => {
      document.removeEventListener("ui:output-mode-request", syncOutputMode);
      document.removeEventListener("ui:settings-section-request", syncSettingsSection);
      document.removeEventListener("ui:settings-dialog-request", syncSettingsDialog);
      document.removeEventListener("ui:follow-up-dialog-request", syncFollowUpDialog);
    };
  }, []);

  return (
    <section className="workspace">
      <header className="app-section app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M21 7.3a3 3 0 0 0-2.1-2.1C17 4.7 12 4.7 12 4.7s-5 0-6.9.5A3 3 0 0 0 3 7.3 31.4 31.4 0 0 0 2.5 12c0 1.6.1 3.2.5 4.7a3 3 0 0 0 2.1 2.1c1.9.5 6.9.5 6.9.5s5 0 6.9-.5a3 3 0 0 0 2.1-2.1c.4-1.5.5-3.1.5-4.7 0-1.6-.1-3.2-.5-4.7Z" />
              <path d="m10 9 5 3-5 3V9Z" />
            </svg>
          </span>
          <div>
            <h1>YouTube AI Brief</h1>
            <p data-i18n="heading">YouTube動画をAI向けに整理</p>
          </div>
        </div>
        <SectionMarker index="01" label="INPUT" />

        <form className="input-panel" id="caption-form">
          <div className="command-row">
            <Input
              id="youtube-url"
              name="url"
              type="url"
              aria-label="YouTube URL"
              placeholder="https://www.youtube.com/watch?v=..."
              autoComplete="off"
              autoFocus
              required
            />
            <Button id="ask-codex-button" type="button" size="lg" disabled>
              <span id="ask-codex-button-label" data-i18n="askCodex">Codexに質問</span>
              <Spinner className="loading-indicator" data-icon="inline-end" />
            </Button>
            <Button
              {...secondaryButtonProps}
              id="transcript-search-toggle"
              type="button"
              disabled
              aria-expanded="false"
              aria-controls="transcript-search-panel"
            >
              <SearchIcon data-icon="inline-start" />
              <span data-i18n="transcriptSearchToggle">字幕内検索</span>
            </Button>
          </div>
          <div className="media-command-row">
            <label className="sr-only" htmlFor="local-media-path" data-i18n="mediaPathLabel">
              ローカル動画ファイル
            </label>
            <Input
              id="local-media-path"
              name="media-path"
              type="text"
              data-i18n-placeholder="mediaPathPlaceholder"
              placeholder="/Users/you/Movies/video.mp4"
              autoComplete="off"
            />
            <Button {...secondaryButtonProps} id="transcribe-media-button" type="button">
              <span id="transcribe-media-button-label" data-i18n="transcribeMedia">動画を文字起こし</span>
              <Spinner className="loading-indicator" data-icon="inline-end" />
            </Button>
          </div>
          <Alert className="status-message" id="message" role="status" aria-live="polite" hidden />
        </form>

        <div className="app-header-actions">
          <Button {...secondaryButtonProps} id="reload-app-button" type="button">
            <RotateCwIcon data-icon="inline-start" />
            <span data-i18n="reloadButton">更新</span>
          </Button>
          <Button {...secondaryButtonProps} id="prompt-settings-button" type="button">
            <SettingsIcon data-icon="inline-start" />
            <span data-i18n="settingsButton">設定</span>
          </Button>
        </div>
      </header>

      <section className="result-layout" aria-live="polite">
        <section className="app-section info-section">
          <SectionMarker index="02" label="VIDEO INFO" />
          <div className="meta-panel">
            <div className="video-preview" id="video-preview" hidden>
              <img id="video-thumbnail" alt="" loading="lazy" />
              <div className="video-preview-body">
                <span className="label" data-i18n="transcriptTitle">AI向け入力</span>
                <strong id="video-preview-title">-</strong>
              </div>
            </div>
            <MetaItem labelKey="selectedLanguage" label="選択言語" valueId="language" value="-" />
            <MetaItem labelKey="characterCount" label="文字数" valueId="char-count" value="0" />
            <MetaItem labelKey="videoDuration" label="動画時間" valueId="video-duration" value="-" />
            <MetaItem labelKey="canonicalUrl" label="動画URL" valueId="canonical-url" value="-" />
            <MetaItem labelKey="viewCount" label="再生数" valueId="view-count" value="-" />
            <MetaItem labelKey="captionSourceLabel" label="字幕種別" valueId="caption-source" value="-" />
            <div className="meta-prompt-settings">
              <label className="label" htmlFor="prompt-template" data-i18n="copyPrompt">生成AIプロンプト</label>
              <NativeSelect id="prompt-template" className="w-full" />
              <p className="prompt-description" id="prompt-description" />
            </div>
          </div>
        </section>

        <section className="app-section output-section">
          <SectionMarker index="03" label="OUTPUT" />
          <div className="output-panel">
            <h2 id="video-title" hidden>AI向け入力</h2>
            <section className="caption-panel" id="caption-panel" hidden>
              <div className="caption-panel-header">
                <h3 data-i18n="captionsTitle">取得可能な字幕</h3>
                <span id="caption-count">0件</span>
              </div>
              <div className="caption-list" id="caption-list" />
            </section>
            <section className="search-panel" id="transcript-search-panel" hidden>
              <div className="search-header">
                <h3 data-i18n="transcriptSearchTitle">字幕内検索</h3>
                <span id="transcript-search-count" data-i18n="transcriptSearchDisabled">字幕取得後に検索できます。</span>
              </div>
              <label className="label" htmlFor="transcript-search" data-i18n="transcriptSearchLabel">検索語</label>
              <Input id="transcript-search" type="search" autoComplete="off" disabled data-i18n-placeholder="transcriptSearchPlaceholder" />
              <div className="search-results" id="transcript-search-results" />
            </section>

            <Tabs
              value={outputMode}
              onValueChange={(value) => {
                if (!isOutputMode(value)) return;
                setOutputMode(value);
                document.dispatchEvent(new CustomEvent("ui:output-mode-change", { detail: value }));
              }}
              className="output-tabs-shell"
            >
              <div className="output-tabs">
                <TabsList variant="line" aria-label="Output view" className="output-tabs-list">
                  <TabsTrigger className="output-tab" id="transcript-view-tab" value="transcript" data-output-mode="transcript" aria-controls="transcript-output" data-i18n="transcriptView">字幕本文</TabsTrigger>
                  <TabsTrigger className="output-tab" id="copy-prompt-view-tab" value="copyPrompt" data-output-mode="copyPrompt" aria-controls="transcript-output" data-i18n="copyPromptView">生成AIプロンプト</TabsTrigger>
                  <TabsTrigger className="output-tab" id="codex-answer-view-tab" value="codexAnswer" data-output-mode="codexAnswer" aria-controls="codex-answer-output" data-i18n="codexAnswerView">AI回答</TabsTrigger>
                </TabsList>
                <span className="output-tab-divider" aria-hidden="true" />
                <div className="codex-toolbar" id="codex-toolbar" hidden>
                  <ToolbarButton id="copy-codex-answer" i18n="copyAnswer">回答をコピー</ToolbarButton>
                  <ToolbarButton id="save-codex-markdown" i18n="saveMarkdown" hidden>Markdown保存</ToolbarButton>
                  <ToolbarButton id="rerun-codex-answer" i18n="rerunAnswer">再実行</ToolbarButton>
                  <ToolbarButton id="follow-up-codex-answer" i18n="followUpAnswer">追加質問</ToolbarButton>
                  <ToolbarButton id="ask-selection-codex" i18n="askSelection">選択範囲で質問</ToolbarButton>
                  <Button id="cancel-codex-answer" type="button" variant="destructive" size="sm" data-i18n="cancelCodex" hidden>キャンセル</Button>
                </div>
              </div>
            </Tabs>
            <Textarea id="transcript-output" spellCheck="false" readOnly />
            <div id="codex-answer-output" className="markdown-output" hidden />
            <section className="history-panel" id="codex-history-panel" hidden>
              <div className="history-header">
                <h3 data-i18n="codexHistoryTitle">AI回答履歴</h3>
                <div className="history-header-actions">
                  <span id="codex-history-count">0</span>
                  <ToolbarButton id="clear-codex-history" i18n="clearCodexHistory">履歴をクリア</ToolbarButton>
                </div>
              </div>
              <div className="history-list" id="codex-history-list" />
            </section>
          </div>
        </section>
      </section>

      <PersistentDialog
          id="prompt-settings-modal"
          open={settingsOpen}
          onClose={() => requestDialogClose("settings")}
          className="settings-dialog-content"
        >
        <section className="settings-panel">
          <div className="settings-header">
            <div>
              <p className="eyebrow" data-i18n="settingsEyebrow">Settings</p>
              <h2 id="prompt-settings-title" data-i18n="settingsTitle">設定</h2>
            </div>
            <ToolbarButton id="prompt-settings-close" i18n="close">閉じる</ToolbarButton>
          </div>
          <Tabs
            value={settingsSection}
            onValueChange={(value) => {
              if (!isSettingsSection(value)) return;
              setSettingsSection(value);
              document.dispatchEvent(new CustomEvent("ui:settings-section-change", { detail: value }));
            }}
          >
          <TabsList variant="line" aria-label="Settings sections" className="settings-tabs">
            <TabsTrigger className="settings-tab" id="settings-prompts-tab" value="prompts" data-settings-section="prompts" data-i18n="promptsTab">プロンプト</TabsTrigger>
            <TabsTrigger className="settings-tab" id="settings-copy-tab" value="copy" data-settings-section="copy" data-i18n="copyTab">コピー</TabsTrigger>
            <TabsTrigger className="settings-tab" id="settings-display-tab" value="display" data-settings-section="display" data-i18n="displayTab">表示</TabsTrigger>
          </TabsList>
          <div className="settings-body">
            <section className="settings-section" id="settings-prompts-section" role="tabpanel" aria-labelledby="settings-prompts-tab" hidden={settingsSection !== "prompts"}>
              <div className="settings-template-list">
                <label className="label" htmlFor="settings-template-select" data-i18n="template">テンプレート</label>
                <select id="settings-template-select" size={6} />
                <div className="settings-actions">
                  <ToolbarButton id="settings-add-template" i18n="add">追加</ToolbarButton>
                  <ToolbarButton id="settings-delete-template" i18n="delete">削除</ToolbarButton>
                </div>
              </div>
              <div className="settings-editor">
                <FormField id="settings-template-title" label="タイトル" i18n="title"><Input id="settings-template-title" type="text" /></FormField>
                <FormField id="settings-template-description" label="説明" i18n="description"><Input id="settings-template-description" type="text" /></FormField>
                <FormField id="settings-template-body" label="本文" i18n="body"><Textarea id="settings-template-body" className="settings-template-body" spellCheck="false" /></FormField>
                <LegacyCheckbox id="settings-template-default" i18n="defaultTemplate">このテンプレートを自動コピーのデフォルトにする</LegacyCheckbox>
                <div className="settings-footer">
                  <ToolbarButton id="settings-reset-template" i18n="reset">初期状態に戻す</ToolbarButton>
                  <Button id="settings-save-template" type="button" size="lg" data-i18n="save">保存</Button>
                </div>
              </div>
            </section>

            <section className="settings-section settings-section-single" id="settings-copy-section" role="tabpanel" aria-labelledby="settings-copy-tab" hidden={settingsSection !== "copy"}>
              <div className="settings-editor">
                <div>
                  <h3 className="settings-section-title" data-i18n="copySettingsTitle">コピー設定</h3>
                  <p className="hint" data-i18n="copySettingsDescription">字幕取得後にクリップボードへ入れる内容と、AIへ渡す追加指示をまとめて管理します。</p>
                </div>
                <div className="copy-option-row">
                  <LegacyCheckbox id="include-image-prompt" i18n="includeImagePrompt" className="option-toggle">画像生成指示を含む</LegacyCheckbox>
                  <LegacyCheckbox id="format-automatic-transcript" i18n="formatAutomaticTranscript" className="option-toggle">自動字幕を整形</LegacyCheckbox>
                </div>
                <div className="display-mode-control" role="group" aria-labelledby="transcript-display-mode-label">
                  <span className="label" id="transcript-display-mode-label" data-i18n="transcriptDisplayModeLabel">字幕表示</span>
                  <TranscriptDisplayModeToggle />
                </div>
              </div>
            </section>

            <section className="settings-section settings-section-single" id="settings-display-section" role="tabpanel" aria-labelledby="settings-display-tab" hidden={settingsSection !== "display"}>
              <div className="settings-editor">
                <label className="label" htmlFor="settings-ui-language" data-i18n="uiLanguage">UI言語</label>
                <NativeSelect id="settings-ui-language" className="w-full">
                  <NativeSelectOption value="ja" data-i18n="japanese">日本語</NativeSelectOption>
                  <NativeSelectOption value="en" data-i18n="english">English</NativeSelectOption>
                </NativeSelect>
                <p className="hint" data-i18n="uiLanguageDescription">アプリ画面の表示言語を切り替えます。コピーされるプロンプト本文は、各テンプレートの内容をそのまま使います。</p>
                <LegacyCheckbox id="settings-completion-sound" i18n="completionSound">AI回答の完了時に音を鳴らす</LegacyCheckbox>
                <div className="debug-log-settings">
                  <span className="label" data-i18n="debugLog">デバッグログ</span>
                  <p className="hint" data-i18n="debugLogDescription">取得時間、生成AIへの依頼内容、応答タイミング、表示処理のタイミングをローカルログへ記録します。通常は見る必要はありません。</p>
                  <ToolbarButton id="settings-open-debug-log" i18n="showDebugLog">ログを表示</ToolbarButton>
                  <div className="debug-log-viewer" id="settings-debug-log-viewer" hidden>
                    <span className="debug-log-path-label" data-i18n="debugLogPath">保存先</span>
                    <code id="settings-debug-log-path" />
                    <Textarea id="settings-debug-log-content" className="debug-log-content" spellCheck="false" readOnly />
                  </div>
                </div>
                <div className="settings-footer">
                  <Button id="settings-save-display" type="button" size="lg" data-i18n="save">保存</Button>
                </div>
              </div>
            </section>
          </div>
          </Tabs>
        </section>
      </PersistentDialog>

      <PersistentDialog
          id="follow-up-modal"
          open={followUpOpen}
          onClose={() => requestDialogClose("follow-up")}
          className="follow-up-dialog-content"
        >
        <section className="follow-up-panel">
          <div className="settings-header">
            <div><p className="eyebrow">Codex</p><h2 id="follow-up-title" data-i18n="followUpTitle">追加質問</h2></div>
            <ToolbarButton id="follow-up-close" i18n="followUpCancel">閉じる</ToolbarButton>
          </div>
          <div className="follow-up-body">
            <FormField id="follow-up-question" label="質問内容" i18n="followUpLabel"><Textarea id="follow-up-question" className="follow-up-question" spellCheck="true" data-i18n-placeholder="followUpPlaceholder" /></FormField>
            <div className="settings-footer"><Button id="follow-up-submit" type="button" size="lg" data-i18n="followUpSubmit">質問する</Button></div>
          </div>
        </section>
      </PersistentDialog>
    </section>
  );
}

function SectionMarker({ index, label }: { index: string; label: string }) {
  return (
    <div className="section-marker" aria-hidden="true">
      <span className="section-number">{index}</span>
      <span className="section-name">{label}</span>
      <span className="section-line" />
    </div>
  );
}

function MetaItem({ labelKey, label, valueId, value }: { labelKey: string; label: string; valueId: string; value: string }) {
  return (
    <div className="meta-summary-item">
      <span className="label" data-i18n={labelKey}>{label}</span>
      <strong id={valueId}>{value}</strong>
    </div>
  );
}

function ToolbarButton({ id, i18n, children, hidden }: { id: string; i18n: string; children: React.ReactNode; hidden?: boolean }) {
  return <Button id={id} type="button" variant="outline" size="sm" data-i18n={i18n} hidden={hidden}>{children}</Button>;
}

function FormField({ id, label, i18n, children }: { id: string; label: string; i18n: string; children: React.ReactNode }) {
  return (
    <Field>
      <FieldLabel htmlFor={id} data-i18n={i18n}>{label}</FieldLabel>
      {children}
    </Field>
  );
}

function LegacyCheckbox({ id, i18n, children, className = "default-template-toggle" }: { id: string; i18n: string; children: React.ReactNode; className?: string }) {
  const [checked, setChecked] = useState(false);

  useLayoutEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; checked: boolean }>).detail;
      if (detail.id === id) setChecked(detail.checked);
    };
    document.addEventListener("ui:checkbox-request", sync);
    return () => document.removeEventListener("ui:checkbox-request", sync);
  }, [id]);

  return (
    <label className={className} htmlFor={`${id}-control`}>
      <input id={id} type="checkbox" hidden />
      <Checkbox
        id={`${id}-control`}
        aria-labelledby={`${id}-label`}
        checked={checked}
        onCheckedChange={(value) => {
          const nextChecked = value === true;
          setChecked(nextChecked);
          const input = document.querySelector<HTMLInputElement>(`#${id}`);
          if (!input) return;
          input.checked = nextChecked;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }}
      />
      <span id={`${id}-label`} data-i18n={i18n}>{children}</span>
    </label>
  );
}

function TranscriptDisplayModeToggle() {
  const [value, setValue] = useState("plain");

  useLayoutEffect(() => {
    const sync = (event: Event) => {
      const mode = (event as CustomEvent<string>).detail;
      if (mode === "plain" || mode === "timestamped") setValue(mode);
    };
    document.addEventListener("ui:display-mode-request", sync);
    return () => document.removeEventListener("ui:display-mode-request", sync);
  }, []);

  return (
    <div className="segmented-control">
      <input hidden type="radio" name="transcript-display-mode" value="plain" />
      <input hidden type="radio" name="transcript-display-mode" value="timestamped" />
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue !== "plain" && nextValue !== "timestamped") return;
          setValue(nextValue);
          const input = document.querySelector<HTMLInputElement>(`input[name="transcript-display-mode"][value="${nextValue}"]`);
          if (!input) return;
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }}
        variant="outline"
        className="w-full"
      >
        <ToggleGroupItem value="plain" className="flex-1"><span data-i18n="plainTranscript">通常</span></ToggleGroupItem>
        <ToggleGroupItem value="timestamped" className="flex-1"><span data-i18n="timestampedTranscript">タイムスタンプ付き</span></ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

function requestDialogClose(dialog: "settings" | "follow-up") {
  document.dispatchEvent(new CustomEvent(`ui:${dialog}-dialog-close-request`));
}

function PersistentDialog({ id, open, onClose, className, children }: { id: string; open: boolean; onClose: () => void; className: string; children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  return (
    <dialog
      ref={dialogRef}
      id={id}
      data-state={open ? "open" : "closed"}
      className={className}
      aria-labelledby={id === "prompt-settings-modal" ? "prompt-settings-title" : "follow-up-title"}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDownCapture={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const clickedBackdrop =
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom;
        if (clickedBackdrop) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

function isOutputMode(value: string): value is "transcript" | "copyPrompt" | "codexAnswer" {
  return value === "transcript" || value === "copyPrompt" || value === "codexAnswer";
}

function isSettingsSection(value: string): value is "prompts" | "copy" | "display" {
  return value === "prompts" || value === "copy" || value === "display";
}
