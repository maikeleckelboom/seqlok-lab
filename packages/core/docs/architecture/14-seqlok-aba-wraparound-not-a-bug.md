## The ABA "Bug" Isn't Actually a Bug in Our Context

The classic ABA problem in lock-free algorithms is this:

> A reader sees a value **A**, gets preempted, another thread changes it to **B** and back to **A**, and when the reader
> resumes it sees **A** again and incorrectly assumes "nothing changed." ([Wikipedia][1])

In other words, equality at two points in time is used as evidence that no intervening change happened, which is not
necessarily true in a concurrent system.

Our design uses 32-bit counters (`u32`) for seqlock state, so people understandably worry about **wraparound**: “If the
counter wraps, can we get ABA?" Let's quantify that.

### What would it take to trigger ABA via wraparound?

We increment our counter monotonically. To get a true ABA by **wrap**, you need:

1. The counter to perform **2³¹ increments** (because we use even/odd for lock state, so one full write cycle is +2),
   and
2. A reader that:

- starts a read,
- is preempted,
- only resumes **after** those 2³¹ increments have happened,
- and then sees the same counter value again.

Let's do the math with an aggressive real-time update rate, 1 kHz:

- Increments per second: **1000**.
- Increments needed for wrap: **2³¹ ≈ 2,147,483,648**.
- Time to wrap:

```text
seconds = 2,147,483,648 / 1000 ≈ 2,147,483.648 s
days    = seconds / (60 * 60 * 24) ≈ 24.85 days
```

So you need roughly **25 days** of _continuous_ 1 kHz writes with a reader that started before this marathon and never
successfully completed or retried during that entire period.

In Seqlok's intended domains (WebAudio worklets, RT graphics, short-lived workers), that's completely outside realistic
session lifetimes.

### Why this is not a practical bug for Seqlok

- Our read protocol checks **pre/post equality** of both `LOCK` and `SEQ` and requires `LOCK` to be even.
- A single complete write changes `LOCK` by +2 and `SEQ` by +1. Any write between the two reads will make either `LOCK`
  or `SEQ` differ, and the read is discarded.
- The only way to get a false "no change" is if both counters **wrap back** to the exact same values **while the reader
  is paused** – that's the ~25-day scenario above.

So:

- For typical RT workloads (minutes–hours of continuous use, maybe a few days), the wraparound-driven ABA scenario is \*
  \*not realistically reachable\*\*.
- The place where the textbook ABA problem matters is in long-lived, high-throughput lock-free structures where counters
  can wrap while references are still in play – see the classic discussion in the ABA problem article. ([Wikipedia][1])

### Our stance and future-proofing

- For current Seqlok targets, the ABA wraparound scenario is a **theoretical edge case**, not a practical production
  risk.
- If we ever need **strict mathematical immunity** (no assumptions about uptime or update rate), we can extend the
  seqlock state with a small **generation counter** (e.g. an extra `u32`), and compare `(SEQ, GEN)` pairs. That would be
  shipped as an **ABI-versioned** plan change.

So when reviewers see "32-bit counter" and immediately suspect an ABA bug, they're not wrong to be cautious – the ABA
problem is real and subtle – but in Seqlok's concrete deployment model, the wraparound path to ABA is effectively
unreachable.

[1]: https://en.wikipedia.org/wiki/ABA_problem?utm_source=chatgpt.com "ABA problem"
