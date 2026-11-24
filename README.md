# فصل‌خوانی

A dreamy season-by-season reading planner. Plain HTML/CSS/JS, no build step.

## Export / import

At the bottom of the page:

- **خروجی گرفتن** downloads `fasl-khani-YYYY-MM-DD.json`: the whole library plus your progress.
- **ورودی** loads such a file and replaces the library (and ticks, if the file has `progress`).
- **برگشت به لیست اولیه** goes back to the list built into `data.js`.

Everything lives in the browser (`localStorage`), so export is also your backup and the way to move between devices.

## File format (`format: 1`)

```json
{
  "app": "fasl-khani", "format": 1,
  "progress": { "read": ["title", "..."], "next": "title" },
  "seasons": { "autumn": [Book], "winter": [Book], "spring": [Book], "summer": [Book] },
  "reserve": [Book + "s"]
}
```

Book: `t` title (unique), `g` genre, `w` weight (سبک / متوسط / سنگین), `n` note, `later: true` = read after summer (autumn only), `s` = season id (reserve only).
Ticks are matched by title, so renaming a book un-ticks it.
