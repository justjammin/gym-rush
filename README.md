# Gym Rush

A raccoon has stolen the town's only tub of protein. You and your gym crew chase it down winding, procedurally built roads through four districts, striking the pose cut into each wall to burst through it.

**Play:** https://justjammin.github.io/pump-parade/

The whole game is `index.html`: canvas rendering, Web Audio sound, no dependencies.

## Controls

| Pose | Keyboard | Touch |
|------|----------|-------|
| Point left | ← or A | Point (left) |
| Most muscular | ↓ or S | Crab |
| Double biceps | ↑ or W | Biceps |
| Point right | → or D | Point (right) |

P or Esc pauses. M mutes.

## Install on a phone

The GitHub Pages build is an installable web app. It gets a home-screen icon, runs full screen, and plays offline after the first visit.

- **iPhone or iPad:** open the play link in Safari, tap Share, then Add to Home Screen.
- **Android:** open the play link in Chrome, open the menu, then Install app.

## Build

```bash
npm run build
```

`build.mjs` uses only Node built-ins. It reads `index.html` and the artwork in `art/`, and writes:

- `dist/web/`: the installable web app (manifest, icons, social preview image, offline service worker). Every push to `main` deploys it to GitHub Pages.
- `dist/itch/` and `dist/gym-rush-itch.zip`: the itch.io HTML5 build.
- `dist/itch-cover.jpg`: a 630×500 cover image for the itch.io page.
- `dist/crazygames-cover-landscape.jpg`, `-portrait.jpg` and `-square.jpg`: the 1920×1080, 800×1200 and 800×800 CrazyGames covers.
- `dist/crazygames/`, `dist/gamepix/` and `dist/gamedistribution/`, each zipped as `dist/gym-rush-<portal>.zip`: portal builds that load the portal's SDK. The GameDistribution build needs the game ID from the GameDistribution developer portal, as `GD_GAME_ID=<id> npm run build`; without it, that build is skipped.
- `dist/telegram/`: the Telegram Mini App page.

Every build talks to the energy server named in `GYM_RUSH_API`, as in `GYM_RUSH_API=<address> npm run build`. Without it the game has no energy (see below).

Each host is a row in the `PLATFORMS` table in `index.html`: how it saves the best score, plays ads, reports gameplay starting and stopping, and celebrates a new best. A host row starts from the web row and overrides only what its host does, and its `init` checks at boot whether the game is running on that host. The game uses the first host that reports itself live, and the web row everywhere else. A new host is one row in `PLATFORMS` and one entry in the `HOSTS` table in `build.mjs`.

## Energy and "keep going"

Busting a wall earns energy: 1 for a good pose and 3 for a perfect. When the last heart breaks, a **Keep going?** screen offers to put the player back in the run with one heart:

- **Watch an ad**, on hosts with rewarded ads, once per run.
- **30 energy**, doubling with each continue in the same run.
- **No thanks**, which ends the run.

When neither continue is possible, the run ends as before. A run that showed a rewarded ad skips the midgame ad on **March again**.

The balance lives on the energy server in `server/`, a Cloudflare Worker with a D1 database. The page never sends a balance, only the run's wall and perfect counts. The server caps what a run earns at the walls the game's schedule allows in the time since the run began, and an energy continue goes through only once the server has taken the energy. On the page, the economy keeps its state in private class fields that nothing outside the game can reach, so unhiding a button or editing storage can't revive a run or change the balance. Players signed in to CrazyGames are identified by their CrazyGames user token, which the server checks against CrazyGames' public key. Everyone else gets a device wallet that the server issues.

Without `GYM_RUSH_API`, or when the server can't be reached, runs play as normal but earn nothing, and the save screen offers only the ad.

### Deploy the energy server

You need a Cloudflare account. The free plan is enough.

```bash
cd server
npm install
npx wrangler login
npx wrangler d1 create gym-rush
```

1. Copy the `database_id` that `wrangler d1 create` prints into `server/wrangler.toml`.
2. Run `npm run deploy` in `server/`. It applies the database migrations and deploys the Worker, then prints its address, such as `https://gym-rush-api.<account>.workers.dev`.
3. Set `CG_GAME_ID` in `wrangler.toml` to the game's id from the CrazyGames developer portal, and deploy again. Until it is set, players signed in to CrazyGames get no energy. The server accepts only tokens issued for this id, because the SDK's local mode gives every developer a demo token signed with the real CrazyGames key.
4. Build with `GYM_RUSH_API=<address> npm run build`. For the GitHub Pages deploy, add a repository variable named `GYM_RUSH_API` under **Settings** → **Secrets and variables** → **Actions** → **Variables**.

The server answers only `localhost` and the origins in `ALLOWED_ORIGINS` in `wrangler.toml`: the GitHub Pages site and CrazyGames. Add another host's origin there before its build can use energy.

`npm run dev` in `server/` serves the API on `http://localhost:8787` with a local database, and `npm test` runs its tests. Neither needs an account. To use energy in the CrazyGames build on `localhost`, put `CG_GAME_ID=yourGameId` in `server/.dev.vars`, which is the id in the SDK's local demo token.

## Store art

`art/` holds the icons, covers, feature graphic, screenshots and preview videos for the site, itch.io, CrazyGames and Google Play. Three tools in `tools/store-art` make them:

- `npm run art` generates the key art with the Higgsfield CLI from prompts in `art.mjs`, and crops each image to its size. It needs `higgsfield auth login` first. Raw generations stay in `tools/store-art/raw/` and are reused, so a rerun spends no credits unless you pass `--force <asset>`.
- `CHROMIUM=<path> npm run shots` plays the real game on a phone-sized screen with an autopilot and frames four moments with captions, as 1080×1920 store screenshots.
- `CHROMIUM=<path> npm run video` plays one seeded run with the autopilot and cuts four clips from it into silent 18-second preview videos: `video-landscape-1920x1080.mp4` and `video-portrait-1080x1620.mp4`. Each opens on its CrazyGames cover. It needs ffmpeg. The run is the same every time, so the videos are rebuilt rather than committed.

Stores require screenshots and videos to show the real game, so only the key art is generated.

## Publish on CrazyGames

On CrazyGames the game opens straight into a run, reports gameplay start and stop, saves the best score through the SDK, mutes when the CrazyGames sound setting is off, asks for a midgame ad when the player taps **March again**, and offers a rewarded ad on the **Keep going?** screen. The SDK spaces midgame ads out itself. If an ad fails or is blocked, the next run starts anyway, and a failed rewarded ad gives no continue.

A new game starts on CrazyGames as a Basic Launch, which serves no ads, so the default build leaves ads out and a lost run goes straight to the over screen. Once CrazyGames selects the game for Full Launch, rebuild with `CRAZYGAMES_FULL=1 npm run build` and upload that zip to turn the ads on.

1. In the CrazyGames developer portal, submit a new HTML5 game and upload `dist/gym-rush-crazygames.zip`.
2. Upload the covers `dist/crazygames-cover-landscape.jpg`, `dist/crazygames-cover-portrait.jpg` and `dist/crazygames-cover-square.jpg`, and the preview videos `art/video-landscape-1920x1080.mp4` and `art/video-portrait-1080x1620.mp4`.
3. Turn on **Progress Save**. Without it the SDK's data module is off, so neither the best score nor a guest's device wallet is kept between visits.
4. Fill in the description and the controls from the table above.

To try the CrazyGames build locally, serve `dist/crazygames` on `localhost` or `127.0.0.1`. The SDK runs in local mode there: ads show as a placeholder overlay and every SDK call is logged to the console.

See `docs/distribution.md` for where CrazyGames fits among the other channels.

## Publish on GameDistribution

GameDistribution pauses and mutes the game around its ads, and **March again** asks for an interstitial.

1. In the GameDistribution developer portal, create the game and copy its game ID.
2. Build with `GD_GAME_ID=<id> npm run build` and upload `dist/gym-rush-gamedistribution.zip`.
3. Open the game in the portal's preview and watch the pre-roll ad through once. This activates the SDK integration.
4. Turn on **Rewarded Ads** for the game in the portal. Without it the **Watch an ad** continue never gets an ad.

To see fake ads while testing, run `gdsdk.openConsole()` in the browser console. Clear the page's local storage to turn the console off again.

## Publish on GamePix

GamePix pauses and mutes the game around its ads and follows the player's GamePix sound setting. **March again** asks for an interstitial, and a new best score is reported as a happy moment. GamePix syncs the best score itself, from local storage.

1. Upload `dist/gym-rush-gamepix.zip` to the GamePix partner portal.
2. Add the covers, screenshots, description and controls.

Served on `localhost`, the SDK simulates the GamePix player, with a placeholder overlay for each ad. Query parameters pick the ad results, for example `?gpx_ad=nofill&gpx_reward=cancel`.

## Publish as a Telegram Mini App

Inside Telegram the game expands to full height, turns off swipe-to-close so poses don't close it, pauses when the player minimizes it, and buzzes on a new best score. Opened anywhere else, the same page runs as the web game.

1. Host `dist/telegram/` at an HTTPS address of its own. Keep it out of the web app's folder on GitHub Pages, because the web app's offline service worker covers that folder and would cache this page in place of the web app.
2. Create a bot with BotFather, then create a Mini App for it with `/newapp` and give it that address.

## Publish on itch.io

1. On itch.io, create a project with **Kind of project** set to **HTML**.
2. Upload `dist/gym-rush-itch.zip` and tick **This file will be played in the browser**.
3. Under **Embed options**, tick **Mobile friendly** and **Fullscreen button**, and set the viewport to 960 × 640.
4. Upload `dist/itch-cover.jpg` as the cover image.
5. Keep visibility on **Draft** or **Restricted** until you want it public.

To push updates from the command line instead, install [butler](https://itch.io/docs/butler/installing.html), run `butler login` once, then:

```bash
ITCH_TARGET=<itch-user>/<game-slug> npm run push:itch
```
