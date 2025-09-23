# How to Calculate and Find EV (Expected Value) Bets

This document explains how to identify positive Expected Value (EV) betting opportunities by comparing odds at your sportsbook against odds from other books, similar to how tools like OddsJam work.

---

## 1) What is Expected Value?
Expected Value (EV) measures the average return of a bet if it were placed many times. A bet has **positive EV** when the payout offered by a sportsbook is better than the true probability of the outcome.

---

## 2) Step 1: Convert American odds to implied probability

**Formula**
```
if odds < 0:
    implied_prob = (-odds) / ((-odds) + 100)
else:
    implied_prob = 100 / (odds + 100)
```

**Example**
- Odds = -150 → Implied probability = 150 / (150 + 100) = 0.60 = 60%
- Odds = +200 → Implied probability = 100 / (200 + 100) = 0.333 = 33.3%

---

## 3) Step 2: Determine “true” probability from the market
- Collect the odds for the same outcome across multiple sportsbooks.
- Remove the vig (the sportsbook’s built-in margin) to get a consensus fair probability.

**Simplified approach**  
- Take the *best* odds available across the market (highest payout for underdogs, lowest price for favorites).  
- Use these best odds to approximate the “true” probability.

**More precise approach**  
- Average implied probabilities across many sharp books.  
- Normalize so that probabilities of all outcomes sum to 100%.

---

## 4) Step 3: Compare your book’s odds to the market
- Convert your book’s odds to implied probability (`p_book`).
- Get the market’s fair probability (`p_true`).

If `p_true > p_book`, the bet is **undervalued** at your book → possible positive EV.

---

## 5) Step 4: Calculate EV per $1 bet
First convert your book’s odds to decimal payout multiplier `M`:
```
if odds < 0:
    M = (100 / -odds) + 1
else:
    M = (odds / 100) + 1
```

Then EV per $1 staked is:
```
EV = p_true * (M - 1) - (1 - p_true) * 1
```

- `p_true`: fair win probability from market
- `M`: decimal multiplier from your book’s odds

If EV > 0, the bet is positive expected value.

---

## 6) Example Walkthrough

- Market consensus (after vig removal): Team A has a 55% chance to win.
- Your sportsbook odds: +120.

1. Convert +120 to implied probability:  
   `p_book = 100 / (120 + 100) = 0.4545 (45.5%)`
2. Market true probability: `p_true = 0.55 (55%)`
3. Decimal multiplier for +120: `M = 120/100 + 1 = 2.20`
4. EV per $1:  
   `EV = 0.55*(1.20) - 0.45*(1)`  
   `EV = 0.66 - 0.45 = +0.21`

Result: +21 cents per dollar wagered → positive EV bet.

---

## 7) How OddsJam-style EV finds value
- Pulls odds from dozens of sportsbooks.  
- Identifies when your book’s line is out of sync with consensus.  
- Flags bets where EV > 0.  
- Often finds edges in props, alt lines, and smaller markets.

---

## 8) Workflow for Your Own Tool
1. Collect all odds for upcoming games from multiple APIs (e.g. The Odds API, SportsDataIO).  
2. Compute consensus fair probabilities (market-based).  
3. For each line offered at **your book**, compare against consensus.  
4. Calculate EV for every available bet.  
5. Sort bets by EV and filter for thresholds (e.g. EV > 2%).  

---

## 9) Tips
- Always remove vig for true probabilities if possible.  
- More books in the consensus = stronger edge detection.  
- Track results over time to validate your edge.  
- EV doesn’t guarantee short-term wins — it’s about long-term profit.

---
