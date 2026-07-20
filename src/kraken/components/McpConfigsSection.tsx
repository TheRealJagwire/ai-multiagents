import type { McpTransport } from "../types.ts";
import { mcpConfigs, mcpDeleteConfirm, mcpForm, mcpFormError } from "../store.ts";
import {
  askDeleteMcpConfig,
  cancelDeleteMcpConfig,
  cancelEditMcpConfig,
  confirmDeleteMcpConfig,
  setMcpField,
  startEditMcpConfig,
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

// The MCP server library, rendered as a section of the Settings modal
// (formerly its own McpConfigsModal — same list + add/edit form, no
// overlay of its own).
export function McpConfigsSection() {
  const transport = mcpForm.value.transport;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
                      fontSize: 10.5,
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
              {mcpDeleteConfirm.value === config.id
                ? (
                  <div style={{ display: "flex", gap: 6, flex: "none" }}>
                    <button
                      type="button"
                      onClick={() => confirmDeleteMcpConfig(config.id)}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--sb-on-primary)",
                        background: "var(--sb-error-dot)",
                        padding: "4px 11px",
                        borderRadius: 7,
                        cursor: "pointer",
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={cancelDeleteMcpConfig}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--sb-text-3)",
                        border: "1px solid var(--sb-border-3)",
                        padding: "4px 11px",
                        borderRadius: 7,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )
                : (
                  <div style={{ display: "flex", gap: 6, flex: "none" }}>
                    <button
                      type="button"
                      onClick={() => startEditMcpConfig(config)}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--sb-text-3)",
                        border: "1px solid var(--sb-border-3)",
                        padding: "4px 11px",
                        borderRadius: 7,
                        cursor: "pointer",
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => askDeleteMcpConfig(config.id)}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--sb-error-text)",
                        border: "1px solid var(--sb-red-tint-4)",
                        padding: "4px 11px",
                        borderRadius: 7,
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{mcpForm.value.editingId ? "Edit server" : "Add a server"}</div>
          {mcpForm.value.editingId && (
            <button
              type="button"
              onClick={cancelEditMcpConfig}
              style={{ fontSize: 11, color: "var(--sb-blue)", cursor: "pointer" }}
            >
              Cancel edit
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 2 }}>
            <div style={labelStyle}>Name</div>
            <input
              placeholder="e.g. filesystem"
              value={mcpForm.value.name}
              onInput={(e) => setMcpField({ name: (e.target as HTMLInputElement).value })}
              style={{ ...inputStyle, background: "var(--sb-surface)" }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            <div style={labelStyle}>Transport</div>
            <div style={{ display: "flex", gap: 5 }}>
              {TRANSPORTS.map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setMcpField({ transport: t })}
                  style={chipStyle(chipState(transport === t, false))}
                >
                  {t}
                </button>
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
                  value={mcpForm.value.command}
                  onInput={(e) => setMcpField({ command: (e.target as HTMLInputElement).value })}
                  style={{ ...monoInputStyle, background: "var(--sb-surface)" }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={labelStyle}>Args (space-separated)</div>
                <input
                  placeholder="-y @modelcontextprotocol/server-filesystem /path"
                  value={mcpForm.value.argsText}
                  onInput={(e) => setMcpField({ argsText: (e.target as HTMLInputElement).value })}
                  style={{ ...monoInputStyle, background: "var(--sb-surface)" }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={labelStyle}>Env (one KEY=VALUE per line)</div>
                <textarea
                  placeholder="API_KEY=..."
                  value={mcpForm.value.envText}
                  onInput={(e) => setMcpField({ envText: (e.target as HTMLTextAreaElement).value })}
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
                  value={mcpForm.value.url}
                  onInput={(e) => setMcpField({ url: (e.target as HTMLInputElement).value })}
                  style={{ ...monoInputStyle, background: "var(--sb-surface)" }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={labelStyle}>Headers (one KEY=VALUE per line)</div>
                <textarea
                  placeholder="Authorization=Bearer ..."
                  value={mcpForm.value.headersText}
                  onInput={(e) => setMcpField({ headersText: (e.target as HTMLTextAreaElement).value })}
                  style={{ ...monoInputStyle, background: "var(--sb-surface)", resize: "none", height: 50 }}
                />
              </div>
            </>
          )}

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={submitMcpConfig}
            disabled={!!mcpFormError.value}
            style={{
              padding: "7px 16px",
              background: mcpFormError.value ? "var(--sb-surface-3)" : "var(--sb-primary)",
              color: mcpFormError.value ? "var(--sb-text-5)" : "var(--sb-on-primary)",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              cursor: mcpFormError.value ? "not-allowed" : "pointer",
            }}
          >
            {mcpForm.value.editingId ? "Save changes" : "+ Add server"}
          </button>
          {mcpFormError.value && <span style={{ fontSize: 11, color: "var(--sb-text-5)" }}>{mcpFormError.value}</span>}
        </div>
      </div>
    </div>
  );
}
