import type { McpTransport } from "../types.ts";
import {
  mcpConfigs,
  mcpFormArgsText,
  mcpFormCommand,
  mcpFormEnvText,
  mcpFormHeadersText,
  mcpFormName,
  mcpFormTransport,
  mcpFormUrl,
  mcpModalOpen,
} from "../store.ts";
import {
  closeMcpModal,
  deleteMcpConfig,
  setMcpFormArgsText,
  setMcpFormCommand,
  setMcpFormEnvText,
  setMcpFormHeadersText,
  setMcpFormName,
  setMcpFormTransport,
  setMcpFormUrl,
  submitMcpConfig,
} from "../actions.ts";
import { chipState } from "../format.ts";
import { chipStyle } from "./TeamMemberRow.tsx";

const TRANSPORTS: McpTransport[] = ["stdio", "http", "sse"];

const inputStyle = {
  border: "1px solid var(--sb-border-3)",
  borderRadius: 9,
  padding: "8px 12px",
  fontSize: 12.5,
  fontFamily: "var(--sb-font-sans)",
  outline: "none",
  color: "var(--sb-text-1)",
};

const monoInputStyle = { ...inputStyle, fontFamily: "var(--sb-font-mono)" };
const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--sb-text-3)" };

export function McpConfigsModal() {
  if (!mcpModalOpen.value) return null;

  const transport = mcpFormTransport.value;

  return (
    <div
      onClick={closeMcpModal}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(28,27,24,.28)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 30,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sb-sbin"
        style={{
          width: 520,
          maxHeight: "86%",
          overflowY: "auto",
          background: "var(--sb-surface)",
          borderRadius: "var(--sb-radius-modal)",
          boxShadow: "var(--sb-shadow-modal)",
          padding: "22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>MCP servers</div>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={closeMcpModal}
            style={{ fontSize: 16, color: "var(--sb-text-5)", cursor: "pointer", padding: "2px 6px" }}
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--sb-text-4)", lineHeight: 1.5 }}>
          A reusable library of MCP server configs — attach any of them to a session or team when you spawn it, from
          the "New session"/"New team" form.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {mcpConfigs.value.length === 0
            ? <div style={{ fontSize: 12, color: "var(--sb-text-5)", padding: "6px 0" }}>No MCP servers configured yet.</div>
            : mcpConfigs.value.map((config) => (
              <div
                key={config.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  border: "1px solid var(--sb-border-2)",
                  borderRadius: 9,
                  padding: "9px 11px",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{config.name}</span>
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: ".05em",
                        color: "var(--sb-text-4)",
                        background: "var(--sb-surface-3)",
                        padding: "2px 7px",
                        borderRadius: 6,
                      }}
                    >
                      {config.transport.toUpperCase()}
                    </span>
                  </div>
                  <div
                    className="sb-mono"
                    style={{
                      fontSize: 10.5,
                      color: "var(--sb-text-5)",
                      paddingTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {config.transport === "stdio" ? `${config.command} ${config.args.join(" ")}`.trim() : config.url}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteMcpConfig(config.id)}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--sb-error-text)",
                    border: "1px solid var(--sb-red-tint-4)",
                    padding: "4px 11px",
                    borderRadius: 7,
                    cursor: "pointer",
                    flex: "none",
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            border: "1px solid var(--sb-border-2)",
            borderRadius: 10,
            padding: "14px 14px",
            background: "var(--sb-bg)",
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>Add a server</div>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 2 }}>
              <div style={labelStyle}>Name</div>
              <input
                placeholder="e.g. filesystem"
                value={mcpFormName.value}
                onInput={(e) => setMcpFormName((e.target as HTMLInputElement).value)}
                style={{ ...inputStyle, background: "var(--sb-surface)" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
              <div style={labelStyle}>Transport</div>
              <div style={{ display: "flex", gap: 5 }}>
                {TRANSPORTS.map((t) => (
                  <span key={t} onClick={() => setMcpFormTransport(t)} style={chipStyle(chipState(transport === t, false))}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {transport === "stdio"
            ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={labelStyle}>Command</div>
                  <input
                    placeholder="npx"
                    value={mcpFormCommand.value}
                    onInput={(e) => setMcpFormCommand((e.target as HTMLInputElement).value)}
                    style={{ ...monoInputStyle, background: "var(--sb-surface)" }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={labelStyle}>Args (space-separated)</div>
                  <input
                    placeholder="-y @modelcontextprotocol/server-filesystem /path"
                    value={mcpFormArgsText.value}
                    onInput={(e) => setMcpFormArgsText((e.target as HTMLInputElement).value)}
                    style={{ ...monoInputStyle, background: "var(--sb-surface)" }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={labelStyle}>Env (one KEY=VALUE per line)</div>
                  <textarea
                    placeholder={"API_KEY=..."}
                    value={mcpFormEnvText.value}
                    onInput={(e) => setMcpFormEnvText((e.target as HTMLTextAreaElement).value)}
                    style={{ ...monoInputStyle, background: "var(--sb-surface)", resize: "none", height: 50 }}
                  />
                </div>
              </>
            )
            : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={labelStyle}>URL</div>
                  <input
                    placeholder="https://example.com/mcp"
                    value={mcpFormUrl.value}
                    onInput={(e) => setMcpFormUrl((e.target as HTMLInputElement).value)}
                    style={{ ...monoInputStyle, background: "var(--sb-surface)" }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={labelStyle}>Headers (one KEY=VALUE per line)</div>
                  <textarea
                    placeholder={"Authorization=Bearer ..."}
                    value={mcpFormHeadersText.value}
                    onInput={(e) => setMcpFormHeadersText((e.target as HTMLTextAreaElement).value)}
                    style={{ ...monoInputStyle, background: "var(--sb-surface)", resize: "none", height: 50 }}
                  />
                </div>
              </>
            )}

          <button
            type="button"
            onClick={submitMcpConfig}
            disabled={!mcpFormName.value.trim()}
            style={{
              alignSelf: "flex-start",
              padding: "7px 16px",
              background: mcpFormName.value.trim() ? "var(--sb-primary)" : "var(--sb-surface-3)",
              color: mcpFormName.value.trim() ? "#fff" : "var(--sb-text-5)",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: mcpFormName.value.trim() ? "pointer" : "not-allowed",
            }}
          >
            + Add server
          </button>
        </div>
      </div>
    </div>
  );
}
