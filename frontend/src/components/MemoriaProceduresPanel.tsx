import { useCallback, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { FileUp, Loader2, Sparkles, Upload, X } from 'lucide-react';
import { api } from '../api/client';

const ACCEPT =
  '.md,.markdown,.txt,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain';

function slugFromFilename(name: string) {
  return name
    .replace(/\.(md|markdown|txt|pdf|docx?)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function parseYamlList(val: string): string[] {
  const t = val.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return [];
  const inner = t.slice(1, -1).trim();
  if (!inner) return [];
  try {
    const parsed = JSON.parse(t.replace(/'/g, '"'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return inner
      .split(',')
      .map((x) => x.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
}

function applyFrontmatterHints(
  text: string,
  setters: {
    setMopId: (v: string) => void;
    setTitle: (v: string) => void;
    setTriggers: (v: string) => void;
    setEntities: (v: string) => void;
    mopId: string;
    title: string;
  }
) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return;
  const map: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    map[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!setters.mopId && map.mop_id) setters.setMopId(map.mop_id.replace(/^["']|["']$/g, ''));
  if (!setters.title && map.title) setters.setTitle(map.title.replace(/^["']|["']$/g, ''));
  const triggers = map.task_triggers || map.triggers;
  if (triggers) {
    const list = parseYamlList(triggers);
    if (list.length) setters.setTriggers(list.join(', '));
  }
  if (map.entities) {
    const list = parseYamlList(map.entities);
    if (list.length) setters.setEntities(list.join(', '));
  }
}

function isOfficeOrPdf(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith('.pdf') || lower.endsWith('.doc') || lower.endsWith('.docx');
}

export function MemoriaProceduresPanel() {
  const [markdown, setMarkdown] = useState('');
  const [mopId, setMopId] = useState('');
  const [title, setTitle] = useState('');
  const [triggers, setTriggers] = useState('');
  const [entities, setEntities] = useState('Network Equipment, Mission Control Dashboard');
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [extractFormat, setExtractFormat] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{
    mop_id: string;
    title: string;
    chunk_count: number;
    recall_hits: number;
    skill_draft?: { skillName: string; markdown: string };
  } | null>(null);

  const applyExtractedText = useCallback(
    (text: string, name: string, hints?: { mop_id?: string; title?: string; format?: string }) => {
      setMarkdown(text);
      setFileName(name);
      setExtractFormat(hints?.format || null);
      setResult(null);
      applyFrontmatterHints(text, {
        setMopId,
        setTitle,
        setTriggers,
        setEntities,
        mopId,
        title,
      });
      if (!mopId) {
        const slug = hints?.mop_id || slugFromFilename(name);
        if (slug) setMopId(slug);
      }
      if (!title) {
        if (hints?.title) setTitle(hints.title);
        else {
          const h1 = text.match(/^#\s+(.+)$/m);
          if (h1) setTitle(h1[1].trim());
        }
      }
    },
    [mopId, title]
  );

  const loadFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase();
      const ok =
        lower.endsWith('.md') ||
        lower.endsWith('.markdown') ||
        lower.endsWith('.txt') ||
        lower.endsWith('.pdf') ||
        lower.endsWith('.doc') ||
        lower.endsWith('.docx') ||
        file.type.startsWith('text/') ||
        file.type.includes('pdf') ||
        file.type.includes('word') ||
        file.type.includes('msword');
      if (!ok) {
        setError('Supported: .pdf, .doc, .docx, .md, .markdown, .txt');
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        setError('File too large (max 15 MB).');
        return;
      }

      setError(null);
      setResult(null);

      // Text/markdown: read locally. PDF/Word: server extract.
      if (!isOfficeOrPdf(file.name) && (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt') || file.type.startsWith('text/'))) {
        const text = await file.text();
        applyExtractedText(text, file.name, { format: 'markdown' });
        return;
      }

      setExtracting(true);
      try {
        const extracted = await api.extractMemoriaProcedureFile(file);
        applyExtractedText(extracted.markdown, extracted.filename || file.name, {
          mop_id: extracted.suggested_mop_id,
          title: extracted.suggested_title,
          format: extracted.format,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to extract text from file');
      } finally {
        setExtracting(false);
      }
    },
    [applyExtractedText]
  );

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void loadFile(file);
    e.target.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  }

  function clearFile() {
    setFileName(null);
    setExtractFormat(null);
    setMarkdown('');
    setResult(null);
  }

  async function handleIngest(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.ingestMemoriaProcedure({
        markdown,
        mop_id: mopId || undefined,
        title: title || undefined,
        task_triggers: triggers
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        entities: entities
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingest failed');
    } finally {
      setBusy(false);
    }
  }

  function downloadSkillDraft() {
    if (!result?.skill_draft?.markdown) return;
    const blob = new Blob([result.skill_draft.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.skill_draft.skillName || 'SKILL'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Ingest Method of Procedure</h2>
        <p className="mt-1 text-sm text-gray-500">
          Import <code className="text-gray-400">.pdf</code>, <code className="text-gray-400">.doc</code>,{' '}
          <code className="text-gray-400">.docx</code>, or markdown. Text is extracted, chunked by{' '}
          <code className="text-gray-400">##</code> headings, and stored in Memoria for agent RAG.
        </p>
      </div>

      <form onSubmit={handleIngest} className="space-y-4 rounded-xl border border-white/5 bg-surface-glass p-4">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={onFileChange}
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`rounded-xl border border-dashed px-4 py-6 text-center transition-colors ${
            dragOver
              ? 'border-accent/60 bg-accent/10'
              : 'border-white/10 bg-surface-overlay/40'
          }`}
        >
          {extracting ? (
            <>
              <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin text-accent" />
              <p className="text-sm text-gray-300">Extracting text from document…</p>
            </>
          ) : (
            <>
              <Upload className="mx-auto mb-2 h-6 w-6 text-gray-500" />
              <p className="text-sm text-gray-300">Drop a MOP file here</p>
              <p className="mt-1 text-[11px] text-gray-600">
                .pdf · .doc · .docx · .md · .txt · max 15 MB
              </p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-gray-300 hover:border-accent/40 hover:text-accent-hover"
              >
                <FileUp className="h-3.5 w-3.5" />
                Choose file
              </button>
            </>
          )}
          {fileName && !extracting && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1 text-xs text-gray-300">
              <span className="max-w-[240px] truncate font-mono">{fileName}</span>
              {extractFormat && (
                <span className="rounded border border-white/10 px-1 text-[10px] uppercase text-gray-500">
                  {extractFormat}
                </span>
              )}
              <button
                type="button"
                onClick={clearFile}
                className="rounded p-0.5 text-gray-500 hover:text-red-300"
                aria-label="Clear imported file"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-gray-400">
            mop_id (optional)
            <input
              value={mopId}
              onChange={(e) => setMopId(e.target.value)}
              placeholder="vdu-bmc-redfish-check"
              className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-400">
            Title (optional)
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="vDU BMC Redfish health check"
              className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Task triggers (comma-separated)
          <input
            value={triggers}
            onChange={(e) => setTriggers(e.target.value)}
            placeholder="redfish, bmc, network probe"
            className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Entities (comma-separated)
          <input
            value={entities}
            onChange={(e) => setEntities(e.target.value)}
            className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-1.5 text-sm text-white outline-none focus:border-accent/50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Extracted / Markdown MOP
          <textarea
            value={markdown}
            onChange={(e) => {
              setMarkdown(e.target.value);
              if (fileName) setFileName(null);
            }}
            required
            rows={14}
            placeholder={'---\ntype: mop\nmop_id: example\n---\n\n# Title\n\n## Steps\n1. ...'}
            className="rounded-lg border border-surface-border bg-surface-overlay px-2.5 py-2 font-mono text-xs text-white outline-none focus:border-accent/50"
          />
        </label>
        <p className="text-[11px] text-gray-600">
          Review/edit extracted text before ingest. Scanned image-only PDFs need OCR first (text layer
          required). Prefer <code className="text-gray-500">.docx</code> over legacy <code className="text-gray-500">.doc</code> when possible.
        </p>
        <button
          type="submit"
          disabled={busy || extracting || !markdown.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          Ingest to Memoria
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-sm text-emerald-200">
            Ingested <strong>{result.chunk_count}</strong> chunks for{' '}
            <code className="text-emerald-100">{result.mop_id}</code> ({result.title}). Recall probe:{' '}
            {result.recall_hits} hit(s).
          </p>
          {result.skill_draft && (
            <button
              type="button"
              onClick={downloadSkillDraft}
              className="inline-flex items-center gap-2 rounded-lg border border-surface-border px-3 py-1.5 text-xs font-medium text-gray-300 hover:border-accent/40 hover:text-accent-hover"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Download skill draft ({result.skill_draft.skillName})
            </button>
          )}
          <p className="text-[11px] text-gray-500">
            Review the draft before copying into <code>~/.cursor/skills/</code>. Agents should still
            recall Memoria for the latest MOP steps.
          </p>
        </div>
      )}
    </div>
  );
}
