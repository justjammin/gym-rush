# Distribution plan

Gym Rush ships on the open web first, with CrazyGames as the lead portal and the GitHub Pages site as the hub every other channel links back to. Short gameplay clips drive players to it. App stores come once the web numbers show that players stay and come back.

## Principles

- **Stay non-exclusive.** Poki's default web deal is exclusive for five years and counts Discord and YouTube Playables as web, which would block CrazyGames, Telegram and Discord. Only consider it if Poki offers terms worth more than all of those together.
- **One build, one row per host.** Each portal or app is a row in the `PLATFORMS` table in `index.html` (ads, gameplay events, saves) plus a build target in `build.mjs`. A new host should never mean new branching in the game code.
- **Gate spending on data.** Nothing that costs money (store fees, paid promotion) starts before the web numbers below say the game holds players.

## Assets

Everything a listing needs is in `art/`, made by `tools/store-art` (see the README):

| Asset | Files | Used by |
|---|---|---|
| Icon | `icon-512.png`, `icon-192.png`, `apple-touch-icon.png` | Site, Google Play, itch.io |
| Feature graphic | `feature-1024x500.jpg` | Google Play |
| Covers | `crazygames-landscape-1920x1080.jpg`, `crazygames-portrait-800x1200.jpg`, `crazygames-square-800x800.jpg` | CrazyGames, other portals |
| itch.io cover | `itch-cover-630x500.jpg` (copied to `dist/itch-cover.jpg` by the build) | itch.io |
| Social card | `social-1200x630.jpg` (published as `social.jpg`) | Link previews |
| Screenshots | `shot-1-smash.jpg` to `shot-4-crew.jpg`, 1080×1920 | Google Play, itch.io, portals |
| Preview videos | `video-landscape-1920x1080.mp4`, `video-portrait-1080x1620.mp4`, silent, 18 seconds (made by `npm run video`, not committed) | CrazyGames, itch.io, Google Play promo |

The preview videos follow CrazyGames' rules: no sound, under 20 seconds, opening on the static cover. The short-form clips need their own vertical 9:16 edits with sound.

## Week 0: launch on the web

1. **Site.** Live at https://justjammin.github.io/pump-parade/ with the share card.
2. **itch.io.** Upload `dist/gym-rush-itch.zip` and `dist/itch-cover.jpg`, add the screenshots, tag it (runner, casual, funny, browser) and make it public. Post devlogs there.
3. **CrazyGames Basic Launch.** Upload `dist/gym-rush-crazygames.zip`, the three covers, the two preview videos, a description and the controls. Turn on **Progress Save** so the best score syncs through the SDK's data module. Basic Launch serves no ads; CrazyGames uses its play data to decide on Full Launch.
4. **Discord server.** Start one for feedback and to recruit Google Play testers early (see weeks 6–10).

## Weeks 1–3: clips

- Three to five vertical clips a week on TikTok, YouTube Shorts and Instagram Reels: perfect-streak smashes, a crew of eight marching, raccoon taunts, funny fails. Hook in the first second; link to the site from the profile.
- Reddit, one post each, spaced out, answering every comment: r/WebGames (direct play link), r/playmygame, r/IndieGaming (a GIF).
- Bluesky and X: weekly #screenshotsaturday posts.

## Weeks 3–6: more portals

- **CrazyGames Full Launch.** This is the tier that earns ad revenue, and CrazyGames picks games for it from their Basic Launch results; a developer cannot opt in. The CrazyGames build already meets the technical requirements (the SDK, gameplay events, ads through the SDK, starting straight in gameplay), so a Full Launch needs no code changes, only CrazyGames' full QA review. The rewarded "keep going" continue and energy from Phase 1 add revenue but are not requirements.
- **GameDistribution.** Non-exclusive, and syndicates to many portals. Its platform row and build target are in place; the build needs the game ID from the GameDistribution portal. A competitor's comparison lists a 33% revenue share and a rule that the copy must match the latest version published elsewhere; confirm both in GameDistribution's own terms.
- **GamePix.** Its platform row and build target are in place.
- **Newgrounds** needs no SDK and can take the itch.io build. Y8 waits unless the others underperform.

## Weeks 4–8: games inside other apps

- **Telegram:** a mini app launched from a bot. The page is `dist/telegram/`, and its platform row is in place.
- **Discord:** an Activity, which needs a Discord application and its client ID.
- **YouTube Playables and Reddit:** applications to send; no code until accepted.

## Weeks 6–10: Google Play, then iOS

- Wrap `dist/web` with Capacitor and add a native platform row with AdMob rewarded and interstitial ads.
- New personal developer accounts must run a closed test with at least 12 testers opted in for 14 continuous days before production access, so recruit testers from Discord well before this point.
- iOS ($99 a year) only if Android players keep coming back.

## What to track

- Plays, average playtime, the share of players who return the next day, the share who reach stage 2, and continues used.
- CrazyGames reports its own numbers. The site and itch.io need analytics added before this list can be read for them.
- If CrazyGames does not pick the game for Full Launch, fix the first minute of play, push the clips and the site, and resubmit.

## Accounts only the owner can create

CrazyGames developer, TikTok, YouTube, Instagram, Reddit, Discord server, GameDistribution, a Telegram bot (BotFather), a Discord application, Google Play ($25 one-time) and Apple Developer ($99 a year).

## Sources

- [CrazyGames requirements](https://docs.crazygames.com/requirements/intro/): Basic Launch needs no SDK and serves no ads; Full Launch needs the SDK, a gameplay start event, ads through the SDK, and landing directly in gameplay.
- [CrazyGames SDK](https://docs.crazygames.com/sdk/intro/): environments, the game module, video ads and the data module.
- [Google Play testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB): 12 testers for 14 continuous days for new personal accounts.
- [Playgama on GameDistribution](https://playgama.com/blog/business-faqs/alternatives-to-gamedistribution-for-html5-distribution/): third-party figures, to be confirmed.
