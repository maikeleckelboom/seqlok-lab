# Seqlok v1.0 – Quick Start Checklist

**Print this. Pin it. Use it daily.**

---

## Day 1: Get Oriented

- [ ] Read [00-GRAVITY-WELL.md](00-GRAVITY-WELL.md) (10 min)
- [ ] Review [completion/STATUS-MATRIX.md](completion/STATUS-MATRIX.md) (15 min)
- [ ] Scan [planning/CRITICAL-PATH.md](planning/CRITICAL-PATH.md) (15 min)
- [ ] Place docs in `seqlok/docs/gravity-well/`

---

## Weekly Rhythm

### Monday: Plan
- [ ] Review last week's progress
- [ ] Plan this week's sprint (use [reference/WEEKLY-SPRINT.md](reference/WEEKLY-SPRINT.md))
- [ ] Set 1 primary goal
- [ ] List Must/Should/Nice tasks
- [ ] Define success criteria

### Tuesday-Thursday: Execute
- [ ] Morning: Check [completion/STATUS-MATRIX.md](completion/STATUS-MATRIX.md) for blockers
- [ ] Work: Execute on Must Have tasks
- [ ] Evening: Update progress notes

### Friday: Review
- [ ] Demo what shipped (run tests, show feature)
- [ ] Update [completion/STATUS-MATRIX.md](completion/STATUS-MATRIX.md)
- [ ] Log any decisions in [reference/DECISION-TEMPLATE.md](reference/DECISION-TEMPLATE.md)
- [ ] Celebrate wins

---

## When You Hit a Decision Point

1. [ ] Run through Decision Framework in [00-GRAVITY-WELL.md](00-GRAVITY-WELL.md)
2. [ ] Does it block v1.0? (Yes → work on it, No → defer)
3. [ ] Does it maintain correctness? (Yes → proceed, No → redesign)
4. [ ] Does it expand API surface? (Yes → justify, No → proceed)
5. [ ] Document using [reference/DECISION-TEMPLATE.md](reference/DECISION-TEMPLATE.md)

---

## First 3 Sprints (Recommended)

### Sprint 1: Lock Error System (Week 1)
- [ ] Generate JSON schema from error registry
- [ ] Add error codes for commands/hotswap stubs
- [ ] CI validates schema
- **Done When**: Schema exists, validates, CI passes

### Sprint 2: Implement Commands (Week 2-3)
- [ ] SWSR ring primitive
- [ ] Producer/consumer APIs
- [ ] Cross-thread tests
- [ ] Stress tests
- **Done When**: Commands work Node + browser, tests pass

### Sprint 3: Implement Hotswap (Week 3-4)
- [ ] Lifecycle state machine
- [ ] Swap protocol
- [ ] Ticket management
- [ ] Property tests
- **Done When**: Hotswap works, invariants enforced

---

## Red Flags (Stop & Fix)

- 🛑 Same blocker appears 2+ weeks in a row → Find parallel work or pivot
- 🛑 Sprint extends beyond 2 weeks → Cut scope, ship something
- 🛑 Success criteria change mid-sprint → Lock scope, defer new items
- 🛑 Hot-path performance regresses >2x → Fix immediately
- 🛑 Type safety violations (`any`, unsafe casts) → Refactor before proceeding
- 🛑 Tests failing in CI → Fix immediately, don't commit more code

---

## Green Lights (You're On Track)

- ✅ Completed sprint every 1-2 weeks
- ✅ [completion/STATUS-MATRIX.md](completion/STATUS-MATRIX.md) shows steady progress
- ✅ All tests pass, benchmarks meet budgets
- ✅ Decisions are documented as you go
- ✅ You feel clear on what to work on next

---

## Critical Path Milestones

- [ ] **Week 1**: Error system locked, schema generated
- [ ] **Week 3**: Commands package complete
- [ ] **Week 5**: Hotswap package complete
- [ ] **Week 6**: Audio deck example running
- [ ] **Week 7**: Rust prototype working
- [ ] **Week 8**: All DoD sections at 90%+
- [ ] **Week 8**: v1.0 SHIP 🚀

---

## Daily Standup (Solo)

**What did I ship yesterday?**
- ...

**What will I ship today?**
- ...

**What's blocking me?**
- ...

---

## Keep This In Mind

### Principles
1. **Correctness > Convenience**
2. **Minimal > Comprehensive**
3. **Documented > Assumed**
4. **Tested > Trusted**
5. **Shipped > Perfect**

### Anti-Patterns to Avoid
- ❌ "Let's add just one more feature..."
- ❌ "I'll refactor this later..."
- ❌ "Let's make it perfect..."
- ❌ Working on non-critical tasks

### Decision Framework
1. Does it block v1.0?
2. Does it maintain correctness?
3. Does it expand API surface?
4. Is it a nice-to-have vs must-have?

---

## Resources

- **Master Index**: [00-GRAVITY-WELL.md](00-GRAVITY-WELL.md)
- **Detailed Status**: [completion/STATUS-MATRIX.md](completion/STATUS-MATRIX.md)
- **Roadmap**: [planning/CRITICAL-PATH.md](planning/CRITICAL-PATH.md)
- **Package Health**: [planning/PACKAGE-READINESS.md](planning/PACKAGE-READINESS.md)
- **Decisions**: [reference/DECISION-TEMPLATE.md](reference/DECISION-TEMPLATE.md)
- **Sprints**: [reference/WEEKLY-SPRINT.md](reference/WEEKLY-SPRINT.md)

---

**Target Ship Date**: 2026-01-19 (8 weeks from now)

**Remember**: Ship production-ready, minimal, correct. Everything else is distraction.
