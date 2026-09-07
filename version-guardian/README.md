# שומר הגרסה — מראה סופר

מטרת הרכיב: להחזיק מקור אמת ברור לגרסת „מראה סופר — טעימה ראשונה”, ולהבדיל בין מונים שונים במקום לערבב אותם.

## ארבעה מזהים נפרדים

1. `display_version` — גרסת המוצר שמוצגת למשתמש בתוך האפליקציה.
2. `site.source_version_number` — מספר גרסת המקור של ChatGPT Sites.
3. `site.projection_revision` — revision של ההקרנה/פרסום.
4. `git_commit` — commit של הקוד, רק כאשר GitHub מוגדר כמקור קנוני.

**אין להשוות `display_version` ל־`source_version_number`.** לדוגמה, גרסת מוצר 82 ו־Sites source version 83 יכולות להיות תקינות לחלוטין יחד.

## מצב חי שנמדד בעת יצירת ה־MVP

- גרסת מוצר מוצגת: `82`.
- ChatGPT Sites source version: `83`.
- projection revision: `39`.
- GitHub: אינו מקור קנוני של האתר החי כרגע.

הנתונים נמצאים ב־`version-manifest.json`.

## רכיבים

- `version-manifest.json` — מקור האמת בפורמט מכונה.
- `version-guardian.js` — מנוע השוואה בין runtime למקור האמת.
- `version-badge.js` — לחיץ קטן „גרסה X · תקין/בדוק/אי־התאמה” וחלון פרטים.
- `tests/version-guardian.test.mjs` — בדיקות רגרסיה.

## כללי חסימה

חוסם פריסה/QA:
- `display_version` בפועל אינו תואם ל־Manifest.
- `site.source_version_number` בפועל אינו תואם ל־Manifest.
- Manifest חסר.
- `git_commit` אינו תואם, אבל רק אם `git_is_canonical=true`.

אזהרה בלבד:
- `projection_revision` השתנה, כאשר גרסת המוצר וגרסת המקור עדיין תואמות.

לא נחשב תקלה:
- `display_version=82` יחד עם `source_version_number=83`.

## שילוב בסיסי

```html
<script src="/version-guardian/version-guardian.js"></script>
<script src="/version-guardian/version-badge.js"></script>
<script>
  MarehSoferVersionBadge.init({
    manifest: VERSION_MANIFEST,
    runtime: {
      display_version: CURRENT_DISPLAY_VERSION,
      site_source_version_number: CURRENT_SITE_SOURCE_VERSION,
      projection_revision: CURRENT_PROJECTION_REVISION,
      git_commit: CURRENT_GIT_COMMIT
    }
  });
</script>
```

ב־ChatGPT Site יש להזין את ערכי runtime מתוך מקור הפריסה עצמו, ולא לקרוא מספרים מטקסט חופשי במסך.

## בדיקות

נבדק ב־7.9.2026: **6/6 עברו**.

הבדיקות כוללות:
- הפרדה תקינה בין גרסת מוצר 82 ל־Sites source 83.
- חסימה על mismatch בגרסת המוצר.
- חסימה על mismatch ב־Sites source version.
- warning בלבד על projection revision.
- אי־אכיפת Git commit כל עוד GitHub אינו קנוני.
- חסימה בטוחה כאשר Manifest חסר.

## צעד הבא

כאשר מקור ה־ChatGPT Site הקנוני זמין לעריכה, לשתול את שלושת קבצי הרכיב ולהוסיף את `version-manifest.json` לתהליך הפריסה. לאחר מכן כל גרסה חדשה חייבת לעדכן Manifest כחלק מהשחרור, לא ידנית לאחר הפריסה.
