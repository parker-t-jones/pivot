# App Store In-App Events

[events.json](events.json) contains the English (U.S.) copy, event settings, Eastern
times, and upload paths. Both events use the **Live Event** badge because they
highlight the live board during scheduled football games. Both are appropriate for
all users and require no event purchase.

| Event                          | Start (ET)                  | End (ET)                    | Earliest planned publish (ET) |
| ------------------------------ | --------------------------- | --------------------------- | ----------------------------- |
| Thanksgiving Football Week     | Wed Nov 25, 2026, 7:00 p.m. | Sat Nov 28, 2026, 1:00 a.m. | Fri Nov 20, 2026, 4:00 p.m.   |
| Fantasy Playoff Command Center | Thu Dec 17, 2026, 7:00 p.m. | Mon Jan 4, 2027, 12:30 a.m. | Thu Dec 3, 2026, 7:00 p.m.    |

## Deep link and iPhone checks

Use `pivot://` for both events. The [Expo config](../../../app/app.json)
registers the scheme and declares only `webcredentials:app.pivot-sports.app`.
The current iOS config has no associated `applinks:` domain.

The [root layout](../../../app/app/_layout.tsx) and
[root route](../../../app/app/index.tsx) wait for the session, then send a
signed-out user to **Welcome** and a signed-in user into `(app)`. From the
event's root entry point, the [app layout](<../../../app/app/(app)/_layout.tsx>)
applies the [existing gates](../../../app/lib/navigationGates.ts) in order:

1. Wait for league and notification permission state to load. A league load
   failure shows the existing error screen.
2. With zero leagues and league setup still required, open **Connect Team**.
   If the user deferred connecting a league for this session, this gate allows
   them through.
3. With a league and undecided notification permission, open the
   **notification permission** screen when the prompt applies.
4. Otherwise open **Home**, whose live board is the event destination.

On an iPhone with the shipping Pivot app installed, paste `pivot://` into
Apple Notes. Tap the link for each case once with Pivot force-quit (cold)
and once with Pivot already running in the background (warm). Return to Notes
before each tap.

| Device case                                                                     | Expected result           |
| ------------------------------------------------------------------------------- | ------------------------- |
| Signed in with at least one league and notification permission already answered | Pivot opens the Home tab. |
| Signed out                                                                      | Pivot opens Welcome.      |

This route was checked in source. Native URL delivery on an iPhone remains
unverified.

## App Store Connect checklist for Parker

1. Run the two iPhone checks above. In App Store Connect, open **Apps → Pivot:
   Fantasy & Picks Live → In-App Events** in the left sidebar.
2. Click **Create In-App Event** (or **+** when the list already has an event).
   Enter the event's `referenceName` from [events.json](events.json), then click
   **Create**.
3. Open the event. For **English (U.S.)**, paste `eventName`,
   `shortDescription`, and `longDescription` into **Event Name**,
   **Short Description**, and **Long Description**, respectively. Select
   **Live Event** for **Badge**.
4. Upload `media.card` as **Event Card Image** (1920 × 1080) and
   `media.details` as **Event Details Page Image** (1080 × 1920). Use the files
   from that event's folder and check both previews for overlay legibility.
5. In **Country or Region Availability**, use the app's available storefronts.
   Set the start and end using the table above. Set **Publish Start Date and
   Time** to the planned publish time or the earliest time the form permits
   after it. The aim is to publish as soon as approved and within 14 days of
   the start. Verify the timezone shown in the form before saving.
6. In **Additional Information**, enter `pivot://` for **Event Deep Link**,
   select **Appropriate for all users** for **Event Purpose** and **Normal**
   priority, and indicate that an in-app purchase is **not required**.
   Select **English (U.S.)** as the event's primary language and click **Save**.
7. Click **Add for Review → Create New Submission**. For the event-only
   submission, select **iOS** on the draft submission screen. Click **Submit
   for Review** and check that the event status becomes **Waiting for Review**.
   Repeat for the second event.
8. Submit Thanksgiving on Nov 20 or 21 and Fantasy Playoffs by about Dec 10.
   Apple review timing varies. Check the event status and scheduled publish
   time after approval. If review runs past a meaningful event window, reassess
   the dates and time-sensitive copy before proceeding.

[Apple's In-App Event setup and review instructions](https://developer.apple.com/help/app-store-connect/offer-in-app-events/offer-in-app-events/) ·
[Apple's media specifications](https://developer.apple.com/help/app-store-connect/reference/in-app-events/in-app-event-media-and-audio-specifications/)

## Re-render the assets

Edit the SVG beside its PNG. From the repository root, export all four with
the Inkscape CLI. The SVG page sets the output dimensions at 96 DPI.

```sh
for svg in docs/marketing/in-app-events/*/*.svg; do
  inkscape "$svg" --export-area-page --export-dpi=96 --export-filename="${svg%.svg}.png"
done
```

Run `pnpm test` to check the PNG headers and event metadata. Preview both
aspect ratios at thumbnail size after edits.
