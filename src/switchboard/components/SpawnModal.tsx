import type { Effort, Model } from "../types.ts";
import {
  draftMembers,
  mcpConfigs,
  memberEffort,
  memberModel,
  modalMode,
  modalOpen,
  promptText,
  spawnAutonomousLead,
  spawnBaseRef,
  spawnCreateNew,
  spawnDir,
  spawnLeadPlans,
  spawnMcpConfigIds,
  type SpawnMode,
  targetTeamId,
  teamName,
  teams,
} from "../store.ts";
import {
  addDraftMember,
  closeSpawnModal,
  removeDraftMember,
  setDraftMember,
  setMemberEffort,
  setMemberModel,
  setModalMode,
  setPromptText,
  setSpawnAutonomousLead,
  setSpawnBaseRef,
  setSpawnCreateNew,
  setSpawnDir,
  setSpawnLeadPlans,
  setTargetTeamId,
  setTeamName,
  submitSpawn,
  toggleSpawnMcpConfig,
} from "../actions.ts";
import { chipState, effortLabel, modelLabel } from "../format.ts";
import { chipStyle } from "./TeamMemberRow.tsx";

const MODELS: Model[] = ["haiku", "sonnet", "opus"];
const EFFORTS: Effort[] = ["low", "medium", "high"];

const inputStyle = {
  border: "1px solid var(--sb-border-3)",
  borderRadius: 9,
  padding: "9px 13px",
  fontSize: 12.5,
  fontFamily: "var(--sb-font-sans)",
  outline: "none",
  color: "var(--sb-text-1)",
};

const labelStyle = { fontSize: 11.5, fontWeight: 600, color: "var(--sb-text-3)" };

function McpConfigChecklist() {
  if (mcpConfigs.value.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={labelStyle}>MCP servers</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {mcpConfigs.value.map((config) => (
          <span
            key={config.id}
            onClick={() => toggleSpawnMcpConfig(config.id)}
            style={chipStyle(chipState(spawnMcpConfigIds.value.includes(config.id), false))}
          >
            {config.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SpawnModal() {
  if (!modalOpen.value) return null;

  const modes: { id: SpawnMode; label: string }[] = [
    { id: "solo", label: "Independent" },
    ...(teams.value.length > 0 ? [{ id: "existing" as SpawnMode, label: "Existing team" }] : []),
    { id: "new", label: "New team" },
  ];

  const title = modalMode.value === "new"
    ? "New team"
    : modalMode.value === "existing"
    ? "Add agent to a team"
    : "New session";

  const spawnLabel = modalMode.value === "new" ? "Start team" : modalMode.value === "existing" ? "Add to team" : "Start session";

  return (
    <div
      onClick={closeSpawnModal}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(28,27,24,.28)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sb-sbin"
        style={{
          width: 560,
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
        <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>

        <div style={{ display: "flex", gap: 8 }}>
          {modes.map((mode) => {
            const active = modalMode.value === mode.id;
            return (
              <button
                type="button"
                key={mode.id}
                onClick={() => setModalMode(mode.id)}
                style={{
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 8,
                  cursor: "pointer",
                  background: active ? "var(--sb-primary)" : "transparent",
                  color: active ? "#fff" : "var(--sb-text-3)",
                  border: active ? "none" : "1px solid var(--sb-border-3)",
                }}
              >
                {mode.label}
              </button>
            );
          })}
        </div>

        {modalMode.value === "new"
          ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={labelStyle}>Team name</div>
                <input
                  placeholder="e.g. Onboarding revamp"
                  value={teamName.value}
                  onInput={(e) => setTeamName((e.target as HTMLInputElement).value)}
                  style={inputStyle}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={labelStyle}>Team goal</div>
                <textarea
                  placeholder="What should this team accomplish?"
                  value={promptText.value}
                  onInput={(e) => setPromptText((e.target as HTMLTextAreaElement).value)}
                  style={{ ...inputStyle, resize: "none", height: 54 }}
                />
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 2 }}>
                  <div style={labelStyle}>Directory</div>
                  <input
                    placeholder={spawnCreateNew.value ? "/absolute/path/to/new-repo" : "/absolute/path/to/repo"}
                    value={spawnDir.value}
                    onInput={(e) => setSpawnDir((e.target as HTMLInputElement).value)}
                    style={{ ...inputStyle, fontFamily: "var(--sb-font-mono)" }}
                  />
                </div>
                {!spawnCreateNew.value && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                    <div style={labelStyle}>Base ref</div>
                    <input
                      placeholder="HEAD"
                      value={spawnBaseRef.value}
                      onInput={(e) => setSpawnBaseRef((e.target as HTMLInputElement).value)}
                      style={{ ...inputStyle, fontFamily: "var(--sb-font-mono)" }}
                    />
                  </div>
                )}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--sb-text-3)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={spawnCreateNew.value}
                  onChange={(e) => setSpawnCreateNew((e.target as HTMLInputElement).checked)}
                />
                Create this as a new repo (empty directory, git init, initial commit)
              </label>
              <div style={{ fontSize: 11, color: "var(--sb-text-4)" }}>
                {spawnCreateNew.value
                  ? "The directory is created fresh, initialized as a git repo with a first commit — then each member gets its own worktree off it."
                  : "Each member gets its own git worktree branched from this ref — they can work concurrently without stepping on each other's changes."}
              </div>
              <McpConfigChecklist />

              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--sb-text-3)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={spawnLeadPlans.value}
                  onChange={(e) => setSpawnLeadPlans((e.target as HTMLInputElement).checked)}
                />
                Let the lead plan the team
              </label>

              {spawnLeadPlans.value && (
                <>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      fontSize: 11.5,
                      color: "var(--sb-text-3)",
                      cursor: "pointer",
                      marginLeft: 20,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={spawnAutonomousLead.value}
                      onChange={(e) => setSpawnAutonomousLead((e.target as HTMLInputElement).checked)}
                    />
                    Let the lead spawn workers itself
                  </label>
                  <div style={{ fontSize: 11, color: "var(--sb-text-4)", marginLeft: 20 }}>
                    {spawnAutonomousLead.value
                      ? "The lead gets a spawn_worker tool and creates teammates on its own as it decides it needs them, up to 8."
                      : "The lead writes a plan (SWITCHBOARD_TASKS.md) and stops. You'll review it, then click \"Start workers\" on the team card to spawn the rest of the team from that plan."}
                  </div>
                </>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={labelStyle}>{spawnLeadPlans.value ? "Lead's task" : "Members"}</div>
                {(spawnLeadPlans.value ? draftMembers.value.slice(0, 1) : draftMembers.value).map((member, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid var(--sb-border-2)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 9,
                      background: "var(--sb-bg)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {!spawnLeadPlans.value && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: ".07em",
                            color: i === 0 ? "#fff" : "var(--sb-text-3)",
                            background: i === 0 ? "var(--sb-primary)" : "var(--sb-surface-3)",
                            padding: "3px 8px",
                            borderRadius: 6,
                            flex: "none",
                          }}
                        >
                          {i === 0 ? "LEAD" : "WORKER"}
                        </span>
                      )}
                      <input
                        placeholder={i === 0 ? "e.g. Plan and coordinate the work" : "e.g. Research competitor pricing"}
                        value={member.task}
                        onInput={(e) => setDraftMember(i, { task: (e.target as HTMLInputElement).value })}
                        style={{ ...inputStyle, flex: 1, padding: "6px 10px", fontSize: 12, background: "var(--sb-surface)" }}
                      />
                      {!spawnLeadPlans.value && draftMembers.value.length > 1 && (
                        <span
                          onClick={() => removeDraftMember(i)}
                          style={{ fontSize: 13, color: "var(--sb-text-5)", cursor: "pointer", padding: "0 3px" }}
                        >
                          ✕
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}>
                          MODEL
                        </span>
                        {MODELS.map((m) => (
                          <span
                            key={m}
                            onClick={() => setDraftMember(i, { model: m })}
                            style={chipStyle(chipState(member.model === m, false))}
                          >
                            {modelLabel(m)}
                          </span>
                        ))}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}>
                          EFFORT
                        </span>
                        {EFFORTS.map((e) => (
                          <span
                            key={e}
                            onClick={() => setDraftMember(i, { effort: e })}
                            style={chipStyle(chipState(member.effort === e, false))}
                          >
                            {effortLabel(e)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                {!spawnLeadPlans.value && (
                  <div
                    onClick={addDraftMember}
                    style={{ fontSize: 12, fontWeight: 600, color: "var(--sb-blue)", cursor: "pointer", width: "fit-content" }}
                  >
                    + Add member
                  </div>
                )}
              </div>
            </>
          )
          : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={labelStyle}>What should this agent do?</div>
                <textarea
                  placeholder="e.g. Audit our onboarding emails and draft improvements"
                  value={promptText.value}
                  onInput={(e) => setPromptText((e.target as HTMLTextAreaElement).value)}
                  style={{ ...inputStyle, resize: "none", height: 74 }}
                />
              </div>
              {modalMode.value === "existing" && (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={labelStyle}>Team</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {teams.value.map((team) => (
                        <span
                          key={team.id}
                          onClick={() => setTargetTeamId(team.id)}
                          style={{ ...chipStyle(chipState(targetTeamId.value === team.id, false)), fontSize: 11.5, padding: "5px 12px" }}
                        >
                          {team.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--sb-text-4)" }}>
                    Working in:{" "}
                    <span style={{ fontFamily: "var(--sb-font-mono)" }}>
                      {teams.value.find((t) => t.id === targetTeamId.value)?.dir ?? "—"}
                    </span>{" "}
                    — a new worktree branches off this team's directory.
                  </div>
                  {(() => {
                    const team = teams.value.find((t) => t.id === targetTeamId.value);
                    const names = team?.mcpConfigIds
                      .map((id) => mcpConfigs.value.find((c) => c.id === id)?.name)
                      .filter((n): n is string => !!n) ?? [];
                    return names.length > 0
                      ? (
                        <div style={{ fontSize: 11, color: "var(--sb-text-4)" }}>
                          MCP servers: {names.join(", ")} — inherited from the team.
                        </div>
                      )
                      : null;
                  })()}
                </>
              )}
              {modalMode.value === "solo" && (
                <>
                  <div style={{ display: "flex", gap: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 2 }}>
                      <div style={labelStyle}>Directory</div>
                      <input
                        placeholder={spawnCreateNew.value ? "/absolute/path/to/new-repo" : "/absolute/path/to/repo"}
                        value={spawnDir.value}
                        onInput={(e) => setSpawnDir((e.target as HTMLInputElement).value)}
                        style={{ ...inputStyle, fontFamily: "var(--sb-font-mono)" }}
                      />
                    </div>
                    {!spawnCreateNew.value && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                        <div style={labelStyle}>Base ref</div>
                        <input
                          placeholder="HEAD"
                          value={spawnBaseRef.value}
                          onInput={(e) => setSpawnBaseRef((e.target as HTMLInputElement).value)}
                          style={{ ...inputStyle, fontFamily: "var(--sb-font-mono)" }}
                        />
                      </div>
                    )}
                  </div>
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--sb-text-3)", cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={spawnCreateNew.value}
                      onChange={(e) => setSpawnCreateNew((e.target as HTMLInputElement).checked)}
                    />
                    Create this as a new repo (empty directory, git init, initial commit)
                  </label>
                  <McpConfigChecklist />
                </>
              )}
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={labelStyle}>Model</div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {MODELS.map((m) => (
                      <span key={m} onClick={() => setMemberModel(m)} style={chipStyle(chipState(memberModel.value === m, false))}>
                        {modelLabel(m)}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={labelStyle}>Effort</div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {EFFORTS.map((e) => (
                      <span key={e} onClick={() => setMemberEffort(e)} style={chipStyle(chipState(memberEffort.value === e, false))}>
                        {effortLabel(e)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
          <button
            type="button"
            onClick={closeSpawnModal}
            style={{
              padding: "8px 16px",
              border: "1px solid var(--sb-border-3)",
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--sb-text-3)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submitSpawn}
            style={{
              padding: "8px 18px",
              background: "var(--sb-primary)",
              color: "#fff",
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {spawnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
