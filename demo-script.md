# BreatheEasy demo video script (Aariv records)

**Length target: 2:45, hard stop at 3:00.** The DSH Hacks V2 rules don't state a video length limit (checked https://dsh-hacks-v2.devpost.com/ and /rules on Oct 10, 2026); 3 minutes is the usual Devpost norm and keeps judges watching. The rules say the video must show the project's purpose, its features, and how users interact with it, so all three are covered below.

## Before you record
- Open the app (live URL https://aariv.me/Breatheasy/ once Pages is on, or open `index.html` from the repo). Use a desktop browser at about 1280 px wide; zoom to 110% so text reads on video.
- Start clean: About section, **Delete all my data**, then reload.
- Pick a day with an orange or worse forecast if you can. If tomorrow is green, that's fine: say so honestly and still walk through it (the guidance lines change with the level).
- Have this text ready to paste into **My plan**:
  - Personal best: `400`
  - Before exercise: `2 puffs of my rescue inhaler 15 minutes before practice`
  - Yellow zone: `Rescue inhaler 2-4 puffs, can repeat every 20 min up to 3 times. Call Dr. if not better in 1 hour.`
  - Known trigger: Ozone
  - (Say on camera these are **example** plan entries, not a real prescription.)
- Screen recorder with mic (OBS, or QuickTime / Windows Game Bar). Record at 1080p.

## Shots and narration

| Time | On screen | Say (about) |
|---|---|---|
| 0:00–0:20 | Title: the app's header and tagline. | "Hi, I'm Aariv. About 4.8 million kids in the U.S. have asthma, and almost half of them had an asthma attack last year. I live near Houston, which the American Lung Association ranks 6th worst in the country for ozone." |
| 0:20–0:35 | Scroll slowly past the safety banner to the tomorrow card. | "Doctors give families a paper asthma action plan with green, yellow and red zones. EPA's advice for bad-ozone days is: follow your action plan. But the plan is in a drawer and the forecast is in another app. BreatheEasy connects them the night before." |
| 0:35–1:00 | Tomorrow card: point at the AQI badge, the category, ozone ppb and PM2.5 rows, then the source line at the bottom. | "This is tomorrow's air for Sugar Land. It takes the hourly ozone and PM2.5 forecast and computes the AQI with EPA's own rules: 8-hour ozone, 24-hour PM2.5, EPA's breakpoints. Down here it shows the forecast service's own number too, so you can see they agree closely. And it's honest about pollen: there's no free U.S. pollen forecast, so it says so." |
| 1:00–1:25 | Go to **My plan**, paste the example entries, tick Ozone, **Save plan**. Jump back to the card: the "Your plan, before exercise" line is now there. | "I copy my plan in from my doctor's sheet. These are example entries. Now on an orange ozone day the card shows EPA's guidance and, right next to it, my own plan's pre-exercise step. The app never makes up medicine or doses; treatment text only comes from what I typed." |
| 1:25–1:50 | **Check in**: type peak flow `300`, tick Cough, **Save check-in**: yellow zone, 75%, the yellow-zone steps. Then tick "Lips or fingernails are blue" and save: red, Call 911. Untick it. | "Each day I check in in about 20 seconds. 300 out of my best of 400 is 75%, so I'm in the yellow zone and it shows my yellow-zone steps. If I check a danger sign, it goes straight to red and puts Call 911 in front of me." |
| 1:50–2:25 | **Insights**: click **Load synthetic demo data**; point at the purple SYNTHETIC banner, the weights chart (pollen, ozone on top), the "Why tomorrow looks…" reasons, the held-out accuracy line. | "Here's the AI part. A small logistic-regression model trains right in my browser on my own check-ins. Nothing is uploaded. To show it working, I'm loading synthetic data, made-up days where the pretend person reacts to ozone, pollen and heat. The model finds pollen and ozone as the top two links, explains tomorrow's outlook reason by reason, and reports 84% accuracy on days it never trained on, against 68% for just guessing. With real data it stays quiet until it has two weeks of check-ins." |
| 2:25–2:40 | Back on the card: click **Share with coach or nurse** (show the note), then **Add to calendar**; switch the language to **ES** for two seconds and back. | "One tap writes a note for my coach or school nurse, or puts tomorrow's plan in my calendar. It's fully in Spanish too, and it all stays on my device: no account, no server." |
| 2:40–2:50 | About section: sources list, then the header again. | "Every number comes from CDC, NHLBI, EPA or the American Lung Association. BreatheEasy isn't medical advice; it helps families actually use the plan their doctor already wrote. Thanks for watching." |

## Honesty checklist (don't say these)
- Don't say it predicts asthma attacks, diagnoses anything, or was tested on real patients.
- Don't present the demo data as a real person's log; say "synthetic" out loud while it's on screen.
- If tomorrow's forecast isn't orange, don't claim it is; describe what's actually on screen.
- It's fine to say an AI assistant helped build it (that's in the README).
