# Free vs paid, per screen

The owner dictates these one screen at a time. Shown in each screen's MyNotes Pro popup (`pro-info.js`: `free` = free-plan limits, `items` = planned Pro extras).
Nothing here is enforced in code yet unless stated.

| Screen | Free | Pro (planned) |
|---|---|---|
| Health Check | Up to 2 family members (popup only, not enforced yet) | see `pro-info.js` |
| Expenses / Yearly plan | The Yearly plan tab, edited by hand | Guided, mandatory yearly plan setup before Home (salary, loans, emergency fund 5% minimum, parents, house, investments, personal spending, savings). Pro only |
| Get started (Home) | Yearly plan step first, filled in by hand; steps in a fixed money order | Yearly plan step replaced by the guided setup; card folds to one row |
| Home: Coming Up strip | Not shown (the dates are still on each feature's own screen) | Shown: FD and bond maturities, dividends, SIP dates (2 days ahead), as draggable cards. **Enforced** in `_homeUpcomingStrip` (personal-ui.js) |
| My Passwords | Everything (no limits) | none: no Pro button, all features free |

Planned Pro price: ₹399 one-time (lifetime, per device), not a subscription. Not on sale yet - no payment path exists, and the figure lives in `plan-compare.js` (`PRO_PRICE`).

Global: any 5 features free; restoring a backup on a different device is Pro.
