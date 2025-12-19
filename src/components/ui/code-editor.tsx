import { useEffect, useRef, useContext } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { ThemeContext } from "@/lib/themes";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  className?: string;
}

// Map file types to Monaco languages
export function getMonacoLanguage(fileType: string): string {
  switch (fileType) {
    case "json":
      return "json";
    case "yaml":
    case "yml":
      return "yaml";
    case "toml":
      return "toml";
    case "properties":
      return "ini"; // Monaco uses 'ini' for properties-like files
    case "xml":
      return "xml";
    default:
      return "plaintext";
  }
}

// Define custom themes that match the app
function defineCustomThemes(monaco: Monaco) {
  // Dark theme matching the app
  monaco.editor.defineTheme("kaizen-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "string", foreground: "a5d6ff" },
      { token: "number", foreground: "79c0ff" },
      { token: "keyword", foreground: "ff7b72" },
      { token: "type", foreground: "ffa657" },
      { token: "variable", foreground: "ffa657" },
      { token: "delimiter", foreground: "8b949e" },
      { token: "key", foreground: "7ee787" },
    ],
    colors: {
      "editor.background": "#0a0a0b",
      "editor.foreground": "#e6edf3",
      "editor.lineHighlightBackground": "#161b22",
      "editor.selectionBackground": "#264f78",
      "editor.inactiveSelectionBackground": "#264f7855",
      "editorLineNumber.foreground": "#484f58",
      "editorLineNumber.activeForeground": "#e6edf3",
      "editorIndentGuide.background": "#21262d",
      "editorIndentGuide.activeBackground": "#30363d",
      "editor.selectionHighlightBackground": "#3fb95044",
      "editorBracketMatch.background": "#3fb95033",
      "editorBracketMatch.border": "#3fb950",
      "editorCursor.foreground": "#58a6ff",
      "editorWhitespace.foreground": "#484f58",
      "scrollbar.shadow": "#0000",
      "scrollbarSlider.background": "#484f5866",
      "scrollbarSlider.hoverBackground": "#484f5899",
      "scrollbarSlider.activeBackground": "#484f58b3",
    },
  });

  // Light theme matching the app
  monaco.editor.defineTheme("kaizen-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "string", foreground: "0550ae" },
      { token: "number", foreground: "0550ae" },
      { token: "keyword", foreground: "cf222e" },
      { token: "type", foreground: "953800" },
      { token: "variable", foreground: "953800" },
      { token: "delimiter", foreground: "57606a" },
      { token: "key", foreground: "116329" },
    ],
    colors: {
      "editor.background": "#fafafa",
      "editor.foreground": "#1f2328",
      "editor.lineHighlightBackground": "#f3f4f6",
      "editor.selectionBackground": "#add6ff",
      "editor.inactiveSelectionBackground": "#add6ff55",
      "editorLineNumber.foreground": "#8b949e",
      "editorLineNumber.activeForeground": "#1f2328",
      "editorIndentGuide.background": "#e5e7eb",
      "editorIndentGuide.activeBackground": "#d1d5db",
      "editor.selectionHighlightBackground": "#34d05844",
      "editorBracketMatch.background": "#34d05833",
      "editorBracketMatch.border": "#34d058",
      "editorCursor.foreground": "#0969da",
      "editorWhitespace.foreground": "#d1d5db",
      "scrollbar.shadow": "#0000",
      "scrollbarSlider.background": "#8b949e44",
      "scrollbarSlider.hoverBackground": "#8b949e66",
      "scrollbarSlider.activeBackground": "#8b949e88",
    },
  });
}

// Register TOML language if not present
function registerTOML(monaco: Monaco) {
  // Check if TOML is already registered
  const languages = monaco.languages.getLanguages();
  if (languages.some((lang: { id: string }) => lang.id === "toml")) {
    return;
  }

  monaco.languages.register({ id: "toml" });

  monaco.languages.setMonarchTokensProvider("toml", {
    tokenizer: {
      root: [
        // Comments
        [/#.*$/, "comment"],

        // Section headers
        [/\[\[?[\w.-]+\]?\]/, "type"],

        // Keys (before =)
        [/[\w.-]+(?=\s*=)/, "key"],

        // Strings
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/"""/, { token: "string", next: "@multilineString" }],

        // Numbers
        [/-?\d+\.\d+([eE][+-]?\d+)?/, "number.float"],
        [/-?\d+([eE][+-]?\d+)?/, "number"],
        [/0x[0-9a-fA-F]+/, "number.hex"],

        // Booleans
        [/\b(true|false)\b/, "keyword"],

        // Dates
        [/\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/, "number"],

        // Operators
        [/[=,\[\]{}]/, "delimiter"],
      ],
      multilineString: [
        [/"""/, { token: "string", next: "@pop" }],
        [/./, "string"],
      ],
    },
  });
}

export function CodeEditor({
  value,
  onChange,
  language = "plaintext",
  readOnly = false,
  className,
}: CodeEditorProps) {
  const { resolvedTheme } = useContext(ThemeContext);
  const monacoRef = useRef<Monaco | null>(null);

  const handleEditorMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;

    // Define custom themes
    defineCustomThemes(monaco);

    // Register TOML language
    registerTOML(monaco);

    // Set initial theme
    monaco.editor.setTheme(resolvedTheme === "dark" ? "kaizen-dark" : "kaizen-light");

    // Configure editor
    editor.updateOptions({
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
      lineNumbers: "on",
      renderLineHighlight: "line",
      tabSize: 2,
      insertSpaces: true,
      wordWrap: "on",
      automaticLayout: true,
      folding: true,
      bracketPairColorization: { enabled: true },
      padding: { top: 8, bottom: 8 },
    });
  };

  // Update theme when app theme changes
  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(
        resolvedTheme === "dark" ? "kaizen-dark" : "kaizen-light"
      );
    }
  }, [resolvedTheme]);

  return (
    <div className={className} style={{ height: "100%", width: "100%" }}>
      <Editor
        value={value}
        onChange={(val) => onChange(val ?? "")}
        language={language}
        theme={resolvedTheme === "dark" ? "kaizen-dark" : "kaizen-light"}
        onMount={handleEditorMount}
        options={{
          readOnly,
          domReadOnly: readOnly,
        }}
        loading={
          <div className="flex items-center justify-center h-full">
            <div className="animate-pulse text-muted-foreground">Loading editor...</div>
          </div>
        }
      />
    </div>
  );
}
