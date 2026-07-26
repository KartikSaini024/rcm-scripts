## What it's for
It watches RCM's Daily Activity report page, checks each dropped-off vehicle against We-Integrate (the yard's check-in system), and - when a vehicle looks properly checked in - lets you close out the return in RCM with one click instead of doing it by hand.

## The features

**1. Continuous scanning**
Every 5 seconds it re-reads the dropoff list and re-checks every vehicle on it against We-Integrate. Runs indefinitely while you have the page open.

**2. Per-vehicle status detection**
For each vehicle, it looks at the *most recent* We-Integrate batch and checks three things:
- Is the batch type "Check In"? (as opposed to Reservation/Maintenance/etc.)
- Was it added *today*?
- Does it have a KMs reading?

If all three pass → the vehicle is "ready." If Check In is today but KMs is missing → it shows a warning button instead ("⚠ No KMs in We-Integrate") and won't let you submit.

**3. Fuel-fee detection**
It scans the free-text notes on that check-in for fuel-related keywords (`refuel`, `low fuel`, `no fuel`, etc.). If any of those words appear *anywhere* in the notes, it flags the vehicle as needing a refuel fee — this is a simple keyword match, not a true/false field, so it can be triggered by phrasing like "no refuel needed" even though that means the opposite.

**4. "Check In" button (manual, per vehicle)**
Every ready vehicle gets a "Check In" button next to it. Clicking it:
- Opens the booking in RCM (in the background)
- Waits for the page to load
- If a refuel fee was flagged, ticks the two fee checkboxes and sets $35
- Sets the return type to "Returned," fuel to "Full," and KMs to the value from We-Integrate
- Sets the Actual Drop-off Date/Time to **right now** (rounded to the nearest 5 minutes) — not the actual time the car arrived
- Submits the form, then closes the background tab and refreshes your page

**5. Auto-Return toggle (off by default)**
A small panel bottom-right lets you turn on fully automatic checking-in — if on, ready vehicles get clicked for you automatically (staggered a couple seconds apart so tabs don't all pop open at once). Off (the default) means nothing happens until you click "Check In" yourself.

**6. Already-returned safety check**
Before filling anything in, it checks if the booking is already marked "Returned" in RCM, and just closes the tab without resubmitting if so.

## The two things to know about, billing-wise
- **Return time = whenever you click Check In**, not the actual time the car came back. If Check In happens late, the customer's booking will show a later — and possibly chargeable — return time.
- **Refuel fee = any mention of the word "refuel"** in the notes, with no understanding of context or negation, so it can occasionally misfire.
