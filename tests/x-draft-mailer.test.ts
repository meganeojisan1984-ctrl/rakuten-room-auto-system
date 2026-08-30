import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildXDraftMail, isXDraftMailEnabled } from "../src/ig/x-draft-mailer";

test("isXDraftMailEnabled requires recipient and smtp credentials", () => {
  assert.equal(
    isXDraftMailEnabled({
      X_DRAFT_EMAIL_TO: "meganeojisan1984@gmail.com",
      SMTP_USER: "sender@gmail.com",
      SMTP_PASS: "app-password",
    }),
    true,
  );
  assert.equal(isXDraftMailEnabled({ X_DRAFT_EMAIL_TO: "meganeojisan1984@gmail.com" }), false);
});

test("buildXDraftMail includes plain text body and image attachments", () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-x-mail-"));
  try {
    const filePath = path.join(dir, "slide-01.jpg");
    fs.writeFileSync(filePath, "jpeg-bytes");
    const mail = buildXDraftMail({
      to: "meganeojisan1984@gmail.com",
      from: "sender@gmail.com",
      subject: "X投稿用: 片手で使える収納ボックス",
      text: "Instagram投稿が完了しました。\n\n本文\n\nhttps://example.com/item",
      attachments: [{ filePath, filename: "slide-01.jpg" }],
    });

    assert.match(mail, /To: meganeojisan1984@gmail\.com/);
    assert.match(mail, /Subject: =\?UTF-8\?B\?/);
    assert.match(mail, /Content-Type: text\/plain; charset=UTF-8/);
    assert.match(mail, /Instagram投稿が完了しました/);
    assert.match(mail, /Content-Disposition: attachment; filename="slide-01.jpg"/);
    assert.match(mail, new RegExp(Buffer.from("jpeg-bytes").toString("base64")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
