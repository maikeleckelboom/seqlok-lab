# Weekly Sprint Planning Guide

**Purpose**: Break DoD into focused 1-2 week work chunks that maintain momentum toward v1.0.

---

## Sprint Philosophy

**Core Principles**:
1. **Focus**: One primary objective per sprint
2. **Ship**: Every sprint ends with something working
3. **Measure**: Clear success criteria, no ambiguity
4. **Adapt**: Review weekly, adjust if blocked

**Anti-Patterns**:
- ❌ "Let's work on everything"
- ❌ Open-ended sprints ("until it's done")
- ❌ No concrete deliverable
- ❌ Success criteria change mid-sprint

---

## Sprint Template

```markdown
# Sprint X: [Theme]

**Dates**: [Start] - [End] (1-2 weeks)
**Primary Goal**: [One sentence]
**Success Metric**: [Quantifiable outcome]

## Objectives

### Must Have (Critical Path) 🔴
1. [Task 1] – [Owner] – [Time estimate]
2. [Task 2] – [Owner] – [Time estimate]

### Should Have (Important) 🟡
1. [Task 3] – [Owner] – [Time estimate]

### Nice to Have (Bonus) 🟢
1. [Task 4] – [Owner] – [Time estimate]

## Dependencies
- [ ] Task A blocks Task B
- [ ] External dependency X

## Risks
- Risk 1: [Description] → Mitigation: [Plan]

## Success Criteria
- [ ] Criterion 1 (testable)
- [ ] Criterion 2 (testable)
- [ ] Criterion 3 (testable)

## Done When
All Must Haves complete + success criteria met + demo works.
```

---

## Example Sprints for Seqlok v1.0

### Sprint 1: Lock Error System (Week 1)

**Dates**: Nov 24 - Nov 30  
**Primary Goal**: Finalize error system to A+ grade  
**Success Metric**: Error schema generated and validated in CI

#### Objectives

##### Must Have 🔴
1. Generate JSON schema from error registry – Maikel – 2 days
2. Add error codes for commands package skeleton – Maikel – 0.5 days
3. Add error codes for hotswap package skeleton – Maikel – 0.5 days
4. CI validates schema matches registry – Maikel – 1 day

##### Should Have 🟡
1. Document error code deprecation policy – Maikel – 0.5 days
2. Add error code usage examples – Maikel – 0.5 days

##### Nice to Have 🟢
1. Generate TypeScript error enum from schema (validation) – Maikel – 1 day

#### Dependencies
- None (can start immediately)

#### Risks
- **Risk**: Schema format bikeshedding → **Mitigation**: Use JSON Schema Draft 7 standard
- **Risk**: Schema generation bugs → **Mitigation**: Validate with small example first

#### Success Criteria
- [ ] `packages/core/schemas/errors.schema.json` exists
- [ ] Schema includes all 50+ error codes with metadata
- [ ] CI step validates registry ↔ schema bijection
- [ ] Commands/hotswap packages have error code stubs

#### Done When
Schema validates, CI passes, team can start using schema for Rust/C++ codegen.

---

### Sprint 2: Implement Commands (Week 2-3)

**Dates**: Dec 1 - Dec 8  
**Primary Goal**: Ship working command ring with cross-thread tests  
**Success Metric**: Commands package at 100% with passing stress tests

#### Objectives

##### Must Have 🔴
1. Implement SWSR ring primitive – Maikel – 3 days
2. Producer/consumer APIs – Maikel – 2 days
3. Cross-thread tests (Node workers) – Maikel – 1 day
4. Stress test (bursty load) – Maikel – 1 day

##### Should Have 🟡
1. Property tests (FIFO, no loss/duplication) – Maikel – 1 day
2. API reference documentation – Maikel – 0.5 days

##### Nice to Have 🟢
1. Browser worker tests (Playwright) – Maikel – 1 day
2. Benchmarks for enqueue/poll – Maikel – 0.5 days

#### Dependencies
- Sprint 1 complete (error codes ready)

#### Risks
- **Risk**: Ring buffer bugs → **Mitigation**: Reuse proven seqlock patterns
- **Risk**: Cross-thread timing issues → **Mitigation**: Use Atomics.wait/notify correctly

#### Success Criteria
- [ ] Commands package builds and exports APIs
- [ ] Producer can enqueue commands
- [ ] Consumer can poll commands
- [ ] Cross-thread test passes (1000+ commands, no loss)
- [ ] Stress test runs 10k commands without failure

#### Done When
Commands work in Node + browser, tests pass, benchmarks meet <1µs budget.

---

### Sprint 3: Implement Hotswap (Week 3-4)

**Dates**: Dec 9 - Dec 22  
**Primary Goal**: Ship engine lifecycle and swap protocol  
**Success Metric**: Hotswap package at 100% with property tests passing

#### Objectives

##### Must Have 🔴
1. Lifecycle state machine – Maikel – 3 days
2. Swap protocol (spawn → prime → activate) – Maikel – 3 days
3. Ticket management – Maikel – 1 day
4. Property tests (lifecycle invariants) – Maikel – 2 days
5. Integration with command ring – Maikel – 2 days

##### Should Have 🟡
1. Abort mid-swap – Maikel – 1 day
2. Crossfade timing – Maikel – 1 day
3. API reference documentation – Maikel – 0.5 days

##### Nice to Have 🟢
1. Formal TLA+ spec for protocol – Maikel – 2 days

#### Dependencies
- Sprint 2 complete (commands ready)

#### Risks
- **Risk**: State machine complexity → **Mitigation**: Start with simplest swap (no crossfade)
- **Risk**: Invariants violated in tests → **Mitigation**: Fuzz test state transitions

#### Success Criteria
- [ ] Hotswap package builds and exports APIs
- [ ] Can spawn new engine
- [ ] Can swap to new engine deterministically
- [ ] Property tests enforce: at most one active engine per slot
- [ ] Property tests enforce: ticket lifecycle reaches terminal state

#### Done When
Hotswap works, property tests pass, integration with commands validated.

---

### Sprint 4: Reference Integrations (Week 5-6)

**Dates**: Dec 23 - Jan 5  
**Primary Goal**: Build audio deck + WebGPU boids examples  
**Success Metric**: Both examples run without errors, demonstrate all features

#### Objectives

##### Must Have 🔴
1. Audio deck: controller + processor + observer – Maikel – 3 days
2. Audio deck: hotswap demo (pitch → timestretch) – Maikel – 2 days
3. WebGPU boids: params/meters – Maikel – 2 days
4. WebGPU boids: hotswap demo (CPU → GPU) – Maikel – 1 day

##### Should Have 🟡
1. Audio deck documentation – Maikel – 0.5 days
2. Boids documentation – Maikel – 0.5 days
3. Record demo videos – Maikel – 1 day

##### Nice to Have 🟢
1. Deploy examples to GitHub Pages – Maikel – 1 day

#### Dependencies
- Sprint 3 complete (hotswap ready)

#### Risks
- **Risk**: Audio dropouts → **Mitigation**: Use proven Web Audio API patterns
- **Risk**: WebGPU compatibility → **Mitigation**: Test on multiple browsers

#### Success Criteria
- [ ] Audio deck plays track without dropouts
- [ ] Audio deck hotswap is seamless (no click/pop)
- [ ] WebGPU boids run at 60fps
- [ ] WebGPU boids hotswap is seamless (no stutter)
- [ ] Both examples documented and reproducible

#### Done When
Examples work in production browsers, demonstrate all Seqlok features.

---

### Sprint 5: Cross-Language Validation (Week 7)

**Dates**: Jan 6 - Jan 12  
**Primary Goal**: Prove interop with Rust/C++  
**Success Metric**: Rust can read params + write meters via SAB

#### Objectives

##### Must Have 🔴
1. Memory layout spec document – Maikel – 2 days
2. Rust param reader – Maikel – 2 days
3. Rust meter writer – Maikel – 1 day
4. Interop test (TS writes params, Rust reads) – Maikel – 1 day

##### Should Have 🟡
1. C++ error schema consumption – Maikel – 1 day
2. C++ backing allocation – Maikel – 1 day

##### Nice to Have 🟢
1. Full Rust host example – Maikel – 3 days (likely v1.1)

#### Dependencies
- Sprint 1 complete (error schema)
- Sprint 4 complete (examples prove TS works)

#### Risks
- **Risk**: Memory layout incompatibilities → **Mitigation**: Start with simplest types (scalars)
- **Risk**: Atomics semantics differ → **Mitigation**: Use standard C11/C++11 atomics

#### Success Criteria
- [ ] Memory layout spec published
- [ ] Rust can read scalar params
- [ ] TS can read scalar meters written by Rust
- [ ] No data corruption under concurrent access

#### Done When
Rust prototype works, interop validated, spec proven correct.

---

### Sprint 6: Production Hardening (Week 8)

**Dates**: Jan 13 - Jan 19  
**Primary Goal**: Lock in quality gates for v1.0 ship  
**Success Metric**: CI fully configured, all DoD sections at 90%+

#### Objectives

##### Must Have 🔴
1. CI perf smoke test – Maikel – 1 day
2. Playwright cross-env matrix – Maikel – 1 day
3. Changelog discipline enforcement – Maikel – 1 day
4. VitePress docs build in CI – Maikel – 1 day
5. SPARBB harness (simplified) – Maikel – 2 days

##### Should Have 🟡
1. Final DoD audit – Maikel – 0.5 days
2. Update all READMEs – Maikel – 0.5 days

##### Nice to Have 🟢
1. v1.0 release blog post draft – Maikel – 1 day

#### Dependencies
- All previous sprints complete

#### Risks
- **Risk**: CI config issues → **Mitigation**: Test locally first
- **Risk**: SPARBB too complex → **Mitigation**: Start with manual scenario tests

#### Success Criteria
- [ ] CI fails on perf regression (>3x budget)
- [ ] CI runs Playwright tests on [Chrome, Firefox, Safari]
- [ ] CI enforces changelog updates
- [ ] VitePress docs build without errors
- [ ] SPARBB runs 1000+ iterations without failure

#### Done When
CI is bulletproof, all quality gates pass, ready to tag v1.0.

---

## Sprint Planning Workflow

### Monday: Sprint Planning
1. **Review last sprint** (30 min)
   - What shipped?
   - What blocked us?
   - What did we learn?

2. **Plan this sprint** (60 min)
   - Pick primary goal from critical path
   - Break into Must/Should/Nice tasks
   - Estimate time for each task
   - Identify dependencies and risks

3. **Set success criteria** (15 min)
   - What does "done" look like?
   - How do we measure success?
   - What's the demo?

### Daily: Progress Check
- What did I ship yesterday?
- What will I ship today?
- What's blocking me?

### Friday: Sprint Review
1. **Demo** (15 min)
   - Show what shipped
   - Run tests, show benchmarks

2. **Retrospective** (30 min)
   - What went well?
   - What slowed us down?
   - What should we change?

3. **Update status** (15 min)
   - Update STATUS-MATRIX.md
   - Update CRITICAL-PATH.md if needed
   - Log decisions in DECISION-TEMPLATE.md

---

## Sprint Anti-Patterns

### ❌ The Kitchen Sink Sprint
**Symptoms**:
- 10+ Must Have tasks
- No clear primary goal
- Success criteria vague

**Fix**: Cut scope. One sprint, one goal.

### ❌ The Moving Target Sprint
**Symptoms**:
- Success criteria change mid-sprint
- New Must Haves added daily
- Scope creeps every standup

**Fix**: Lock scope Monday, defer everything else to next sprint.

### ❌ The Zombie Sprint
**Symptoms**:
- Sprint extends beyond 2 weeks
- No clear end date
- "We'll know when it's done"

**Fix**: Time-box strictly. Ship something, even if incomplete.

### ❌ The Lone Wolf Sprint
**Symptoms**:
- No demo at end
- No one knows what shipped
- Documentation after-the-fact

**Fix**: Demo Friday, document as you go.

---

## Sprint Metrics

Track these to maintain velocity:

### Velocity
- **Tasks completed** per sprint
- **Must Haves** vs **Should Haves** shipped
- **Days blocked** per sprint

### Quality
- **Test pass rate** (should be 100%)
- **CI failure rate** (should be <5%)
- **Bugs introduced** per sprint

### Scope Management
- **Tasks deferred** (healthy churn: ~20%)
- **Tasks added mid-sprint** (should be <10%)
- **Success criteria met** (target: 100%)

---

## Example Sprint Board (Markdown)

```markdown
# Sprint 2: Implement Commands

## In Progress 🚧
- [ ] SWSR ring primitive (Maikel) – Day 2 of 3

## Blocked 🛑
- None

## Done ✅
- [x] Error codes for commands package

## Backlog (Next Sprint)
- [ ] Browser worker tests
- [ ] Benchmarks
```

---

## Adapting When Blocked

If a sprint gets blocked:

### Option 1: Pivot to Parallel Work
- Can't finish commands? Start memory layout spec (independent)
- Can't finish hotswap? Start reference integration planning

### Option 2: Reduce Scope
- Move Should Haves to next sprint
- Ship minimal version of Must Haves

### Option 3: Extend Sprint (Last Resort)
- Only if <2 days needed
- Never extend >1 week
- Always document why

---

## Sprint Checklist

Before starting any sprint:

- [ ] Primary goal is clear (one sentence)
- [ ] Success criteria are measurable
- [ ] Dependencies are identified
- [ ] Time estimates are realistic
- [ ] Must Haves align with critical path
- [ ] Demo is planned
- [ ] Risks have mitigations

---

## Using This Guide

### For Solo Dev (Maikel)
- Treat this as a personal accountability framework
- Demo to yourself Friday (run tests, check benchmarks)
- Retrospective is honest reflection
- Track velocity to predict ship date

### For Team (Future)
- Monday planning is synchronous
- Daily standups are async (Slack/Discord)
- Friday demo is team event
- Rotate sprint lead

---

**Last Updated**: 2025-11-24  
**Maintained By**: Maikel
