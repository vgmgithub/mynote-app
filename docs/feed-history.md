# News history: what to keep, and what to analyse it with

Status: a plan, not built. Written 21 Sep 2026. Nothing here changes the data schema or the backup format.

## What rotates today

| Where | Kept | Set in |
|---|---|---|
| On the phone | **7 days** of daily buckets per stock, pruned on every save | `FEED_WINDOW_MS`, `feed.js` |
| On the server | **10 days** per company, swept on the way past | `ARCHIVE_DAYS`, `server/lib/news.js` |
| Upstream | last 24 hours, up to 3 articles per request | `marketauxUrl`, `server/lib/news.js` |

So roughly ten days exist anywhere, and everything older is gone for good. The recommendation engine therefore only ever sees a week.

## The question
Keep everything on the server, show the last 7 days in the app, and compute the insights from the full history instead of a week. Is that better, and is it feasible?

## Feasibility: storage
A trimmed article is about 1 KB. At 3 a day per company:

| Companies followed | Full articles for a year | Daily summaries for a year |
|---|---|---|
| 200 | ~220 MB | ~4 MB |
| 1,000 | ~1.1 GB | ~18 MB |
| 5,000 | ~5.5 GB | ~90 MB |

A free TiDB tier is about 5 GB, so keeping **every article forever** stops being free somewhere around a thousand followed companies — which is a success case, not a far-off one.

But that is the wrong thing to keep. Almost all the long-run analytical value is in a **daily summary row** per company: article count, average sentiment, positive/negative counts, and any event flags. About 50 bytes a day. The headlines themselves are only worth reading while they are recent.

**So: keep full articles for ~30 days, and a daily summary row forever.** Storage stays trivial for years, and nothing analytically useful is lost.

## Feasibility: can the server compute the recommendation?
Only half of it, and that half is the point.

`computeRecommendation` (feed.js) needs two kinds of input:

- **News**, which is the same for everyone: sentiment, article counts, event keywords.
- **The user's own numbers**, which the server must never hold: `buyPrice`, `currentPrice`, `conviction`, and `stock.history` (monthly returns).

The server cannot produce a hold/buy/sell call without the second kind, and sending it there would break "your data never leaves this device" and turn the analytics server into a store of people's portfolios. That is not worth doing.

The split that works:

- **The server computes the news signal per company** — identical for every holder, so it is computed once and served from cache. Sentiment over 7/30/90 days, article volume, event flags, and how today compares with that company's own norm.
- **The app combines it with the user's private numbers** locally, exactly as `computeRecommendation` does now.

Privacy is unchanged, the heavy history lives where the history is, and the per-company work is done once rather than on every phone.

## Which window actually analyses best
Not the shortest, and not "everything". Three windows, each answering a different question:

| Window | What it is for | Why |
|---|---|---|
| **7 days** | Today's call | Recent news is what is not yet priced in. This is where the signal is. |
| **30 days** | Direction | Is coverage getting better or worse? One week is too short to tell a trend from noise. |
| **90 days or all** | The baseline and event memory | What is *normal* coverage for this company, and did something serious happen that is still unresolved. |

The reason the long window matters is not that old news predicts tomorrow. It is that **absolute sentiment thresholds are wrong**. Some companies are covered negatively all the time; judging them against a fixed `-0.15` triggers a warning every single day until it means nothing. Judged against their own 90-day norm, only a real change moves the call. The same fix stops calls flip-flopping day to day, which is the most common complaint about signals like this.

The sample size argues the same way. Three articles a day is a thin sample, and an average over three items is noisy. A longer baseline is what makes a short window readable.

**Recommendation: tiered windows with a relative baseline.** Not a longer window for its own sake, and not more data into the same rules — the rules themselves should compare against the company's own history rather than fixed numbers.

## Shape of the work
1. **Server: daily summary table.** `news_daily(name_key, day, articles, avg_sentiment, pos, neg, events)`. Written whenever a day is fetched. Tiny, and kept indefinitely.
2. **Server: compaction.** Extend the existing sweep — full articles past 30 days are deleted, the summary row stays. One line beside the current `ARCHIVE_DAYS` delete.
3. **Server: a per-company signal.** `GET /api/news` grows a `signal` block: sentiment over 7/30/90 days, article volume, event flags, and today's reading as a deviation from the 90-day norm. Cached per company per day, so it costs one computation regardless of how many people hold it.
4. **App: keep showing 7 days.** No change to the Feed's reading experience — the extra history is input to the call, not more to scroll.
5. **App: use the baseline.** `computeRecommendation` takes the signal block and compares relative to the norm instead of against fixed thresholds. It is pure logic with unit tests, so the old and new rules can be run against the same fixtures and compared before switching.
6. **Backfill is not possible.** Only about ten days exist right now, so the 90-day baseline builds up from the day this ships. Until there is enough history, the rules fall back to today's fixed thresholds — worth stating plainly in the code rather than quietly producing a weak baseline.

## Honest caveats
- A baseline needs roughly a month before it beats the fixed thresholds. This is an investment that pays off later, not an immediate improvement.
- More history does not fix a thin source. Three articles a day from one provider stays the real ceiling on signal quality; a second source would help more than a longer window.
- None of this makes the output financial advice, and the wording in the app should not start sounding more confident because the numbers behind it got longer.

## Open decisions
- Keep full articles for 30 days, or fewer?
- Ship the summary table now so history starts accumulating, even before the rules use it? (Cheap, and the sooner it starts the sooner the baseline is usable.)
- Is a second news source worth it, given it would raise the quality ceiling more than any window change?
