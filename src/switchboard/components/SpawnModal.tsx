import type { Effort, Model, RecurrenceUnit } from "../types.ts";
import {
  dirSuggestions,
  draftMembers,
  mcpConfigs,
  memberEffort,
  memberModel,
  modalMode,
  modalOpen,
  promptText,
  type RecurrenceMode,
  recentDirs,
  spawnAutonomousLead,
  spawnBaseRef,
  spawnCreateNew,
  spawnDir,
  spawnSessionName,
  spawnError,
  spawnLeadPlans,
  spawnMcpConfigIds,
  type SpawnMode,
  spawnNoWorktree,
  spawnRecurrenceDays,
  spawnRecurrenceEvery,
  spawnRecurrenceMode,
  spawnRecurrenceUnit,
  spawnScheduleAt,
  spawnScheduleEnabled,
  spawnSubmitting,
  spawnValidationError,
  targetTeamId,
  teamName,
  teams,
} from "../store.ts";
import {
  addDraftMember,
  closeSpawnModal,
  pickSpawnDir,
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
  setSpawnSessionName,
  setSpawnLeadPlans,
  setSpawnNoWorktree,
  setSpawnRecurrenceEvery,
  setSpawnRecurrenceMode,
  setSpawnRecurrenceUnit,
  setSpawnScheduleAt,
  setSpawnScheduleEnabled,
  setTargetTeamId,
  setTeamName,
  submitSpawn,
  toggleSpawnMcpConfig,
  toggleSpawnRecurrenceDay,
} from "../actions.ts";
import { chipState, effortLabel, modelLabel } from "../format.ts";
import { chipStyle } from "./TeamMemberRow.tsx";

const MODELS: Model[] = ["haiku", "sonnet", "opus"];
const RECURRENCE_MODES: { id: RecurrenceMode; label: string }[] = [
  { id: "none", label: "Does not repeat" },
  { id: "interval", label: "Every…" },
  { id: "weekly", label: "Weekly on…" },
];
const RECURRENCE_UNITS: RecurrenceUnit[] = ["minutes", "hours", "days"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

// Live filesystem suggestions while typing take priority over the recent
// list — once you're typing a path, autocomplete against what's actually on
// disk is more useful than what you used last time.
function DirectorySuggestions() {
  const suggestions = dirSuggestions.value;
  const recents = suggestions.length === 0 ? recentDirs.value : [];
  if (suggestions.length === 0 && recents.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {(suggestions.length > 0 ? suggestions : recents).map((dir) => (
        <button
          type="button"
          key={dir}
          onClick={() => pickSpawnDir(dir)}
          className="sb-mono"
          style={{
            fontSize: 10.5,
            color: "var(--sb-text-3)",
            border: "1px solid var(--sb-border-3)",
            background: "var(--sb-surface)",
            padding: "3px 9px",
            borderRadius: 7,
            cursor: "pointer",
          }}
        >
          {dir}
        </button>
      ))}
    </div>
  );
}

function McpConfigChecklist() {
  if (mcpConfigs.value.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={labelStyle}>MCP servers</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {mcpConfigs.value.map((config) => (
          <button
            type="button"
            key={config.id}
            onClick={() => toggleSpawnMcpConfig(config.id)}
            style={chipStyle(chipState(spawnMcpConfigIds.value.includes(config.id), false))}
          >
            {config.name}
          </button>
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

  const spawnLabel = spawnScheduleEnabled.value
    ? "Schedule"
    : modalMode.value === "new"
    ? "Start team"
    : modalMode.value === "existing"
    ? "Add to team"
    : "Start session";
  const validationError = spawnValidationError.value;

  return (
    <div
      onClick={closeSpawnModal}
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--sb-overlay)",
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
                  color: active ? "var(--sb-on-primary)" : "var(--sb-text-3)",
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
                    placeholder={spawnNoWorktree.value
                      ? "/absolute/path/to/folder"
                      : spawnCreateNew.value
                      ? "/absolute/path/to/new-repo"
                      : "/absolute/path/to/repo"}
                    value={spawnDir.value}
                    onInput={(e) => setSpawnDir((e.target as HTMLInputElement).value)}
                    style={{ ...inputStyle, fontFamily: "var(--sb-font-mono)" }}
                  />
                </div>
                {!spawnCreateNew.value && !spawnNoWorktree.value && (
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
              <DirectorySuggestions />
              <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--sb-text-3)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={spawnNoWorktree.value}
                  onChange={(e) => setSpawnNoWorktree((e.target as HTMLInputElement).checked)}
                />
                Skip git — run directly in this folder (no repo required, no worktrees)
              </label>
              {!spawnNoWorktree.value && (
                <>
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
                </>
              )}
              <McpConfigChecklist />

              {spawnNoWorktree.value && (
                <div style={{ fontSize: 11, color: "var(--sb-text-4)" }}>
                  Every member runs directly in this folder, sharing it — no branch isolation, so members can step
                  on each other's changes. Team planning and worker auto-spawning need worktrees, so they're
                  unavailable while this is checked.
                </div>
              )}

              {!spawnNoWorktree.value && (
                <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--sb-text-3)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={spawnLeadPlans.value}
                    onChange={(e) => setSpawnLeadPlans((e.target as HTMLInputElement).checked)}
                  />
                  Let the lead plan the team
                </label>
              )}

              {!spawnNoWorktree.value && spawnLeadPlans.value && (
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
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: ".07em",
                            color: i === 0 ? "var(--sb-on-primary)" : "var(--sb-text-3)",
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
                        placeholder="Name (optional)"
                        value={member.name}
                        onInput={(e) => setDraftMember(i, { name: (e.target as HTMLInputElement).value })}
                        style={{ ...inputStyle, width: 110, flex: "none", padding: "6px 10px", fontSize: 12, background: "var(--sb-surface)" }}
                      />
                      <input
                        placeholder={i === 0 ? "e.g. Plan and coordinate the work" : "e.g. Research competitor pricing"}
                        value={member.task}
                        onInput={(e) => setDraftMember(i, { task: (e.target as HTMLInputElement).value })}
                        style={{ ...inputStyle, flex: 1, padding: "6px 10px", fontSize: 12, background: "var(--sb-surface)" }}
                      />
                      {!spawnLeadPlans.value && draftMembers.value.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeDraftMember(i)}
                          aria-label="Remove member"
                          style={{ fontSize: 13, color: "var(--sb-text-5)", cursor: "pointer", padding: "0 3px" }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}>
                          MODEL
                        </span>
                        {MODELS.map((m) => (
                          <button
                            type="button"
                            key={m}
                            onClick={() => setDraftMember(i, { model: m })}
                            style={chipStyle(chipState(member.model === m, false))}
                          >
                            {modelLabel(m)}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", color: "var(--sb-text-5)", marginRight: 3 }}>
                          EFFORT
                        </span>
                        {EFFORTS.map((e) => (
                          <button
                            type="button"
                            key={e}
                            onClick={() => setDraftMember(i, { effort: e })}
                            style={chipStyle(chipState(member.effort === e, false))}
                          >
                            {effortLabel(e)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
                {!spawnLeadPlans.value && (
                  <button
                    type="button"
                    onClick={addDraftMember}
                    style={{ fontSize: 12, fontWeight: 600, color: "var(--sb-blue)", cursor: "pointer", width: "fit-content" }}
                  >
                    + Add member
                  </button>
                )}
              </div>
            </>
          )
          : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={labelStyle}>Name (optional — auto-generated if blank)</div>
                <input
                  placeholder="e.g. Onboarding audit"
                  value={spawnSessionName.value}
                  onInput={(e) => setSpawnSessionName((e.target as HTMLInputElement).value)}
                  style={inputStyle}
                />
              </div>
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
                        <button
                          type="button"
                          key={team.id}
                          onClick={() => setTargetTeamId(team.id)}
                          style={{ ...chipStyle(chipState(targetTeamId.value === team.id, false)), fontSize: 11.5, padding: "5px 12px" }}
                        >
                          {team.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--sb-text-4)" }}>
                    Working in:{" "}
                    <span style={{ fontFamily: "var(--sb-font-mono)" }}>
                      {teams.value.find((t) => t.id === targetTeamId.value)?.dir ?? "—"}
                    </span>{" "}
                    {teams.value.find((t) => t.id === targetTeamId.value)?.useWorktree ?? true
                      ? "— a new worktree branches off this team's directory."
                      : "— this team skips git/worktrees, so it runs directly in that folder."}
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
                        placeholder={spawnNoWorktree.value
                          ? "/absolute/path/to/folder"
                          : spawnCreateNew.value
                          ? "/absolute/path/to/new-repo"
                          : "/absolute/path/to/repo"}
                        value={spawnDir.value}
                        onInput={(e) => setSpawnDir((e.target as HTMLInputElement).value)}
                        style={{ ...inputStyle, fontFamily: "var(--sb-font-mono)" }}
                      />
                    </div>
                    {!spawnCreateNew.value && !spawnNoWorktree.value && (
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
                  <DirectorySuggestions />
                  <label
                    style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--sb-text-3)", cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={spawnNoWorktree.value}
                      onChange={(e) => setSpawnNoWorktree((e.target as HTMLInputElement).checked)}
                    />
                    Skip git — run directly in this folder (no repo required, no worktrees)
                  </label>
                  {!spawnNoWorktree.value && (
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
                  )}
                  <McpConfigChecklist />
                </>
              )}
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={labelStyle}>Model</div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {MODELS.map((m) => (
                      <button
                        type="button"
                        key={m}
                        onClick={() => setMemberModel(m)}
                        style={chipStyle(chipState(memberModel.value === m, false))}
                      >
                        {modelLabel(m)}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={labelStyle}>Effort</div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {EFFORTS.map((e) => (
                      <button
                        type="button"
                        key={e}
                        onClick={() => setMemberEffort(e)}
                        style={chipStyle(chipState(memberEffort.value === e, false))}
                      >
                        {effortLabel(e)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

        {modalMode.value !== "existing" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--sb-text-3)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={spawnScheduleEnabled.value}
                onChange={(e) => setSpawnScheduleEnabled((e.target as HTMLInputElement).checked)}
              />
              Schedule for later instead of starting now
            </label>
            {spawnScheduleEnabled.value && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 220 }}>
                  <div style={labelStyle}>When (local time)</div>
                  <input
                    type="datetime-local"
                    value={spawnScheduleAt.value}
                    onInput={(e) => setSpawnScheduleAt((e.target as HTMLInputElement).value)}
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={labelStyle}>Repeat</div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {RECURRENCE_MODES.map((mode) => (
                      <button
                        type="button"
                        key={mode.id}
                        onClick={() => setSpawnRecurrenceMode(mode.id)}
                        style={chipStyle(chipState(spawnRecurrenceMode.value === mode.id, false))}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                {spawnRecurrenceMode.value === "interval" && (
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 70 }}>
                      <div style={labelStyle}>Every</div>
                      <input
                        type="number"
                        min={1}
                        value={spawnRecurrenceEvery.value}
                        onInput={(e) => setSpawnRecurrenceEvery(Number((e.target as HTMLInputElement).value) || 1)}
                        style={inputStyle}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 5, paddingBottom: 1 }}>
                      {RECURRENCE_UNITS.map((unit) => (
                        <button
                          type="button"
                          key={unit}
                          onClick={() => setSpawnRecurrenceUnit(unit)}
                          style={chipStyle(chipState(spawnRecurrenceUnit.value === unit, false))}
                        >
                          {unit}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {spawnRecurrenceMode.value === "weekly" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={labelStyle}>On these days</div>
                    <div style={{ display: "flex", gap: 5 }}>
                      {DAY_LABELS.map((label, day) => (
                        <button
                          type="button"
                          key={day}
                          onClick={() => toggleSpawnRecurrenceDay(day)}
                          style={chipStyle(chipState(spawnRecurrenceDays.value.includes(day), false))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {spawnError.value && (
          <div
            style={{
              fontSize: 11.5,
              color: "var(--sb-error-text)",
              background: "var(--sb-error-bg)",
              border: "1px solid var(--sb-red-tint-3)",
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            {spawnError.value}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
          {validationError && <span style={{ fontSize: 11, color: "var(--sb-text-5)" }}>{validationError}</span>}
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
            disabled={!!validationError || spawnSubmitting.value}
            onClick={submitSpawn}
            style={{
              padding: "8px 18px",
              background: validationError || spawnSubmitting.value ? "var(--sb-surface-3)" : "var(--sb-primary)",
              color: validationError || spawnSubmitting.value ? "var(--sb-text-5)" : "var(--sb-on-primary)",
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: validationError || spawnSubmitting.value ? "not-allowed" : "pointer",
            }}
          >
            {spawnSubmitting.value ? "Starting…" : spawnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
