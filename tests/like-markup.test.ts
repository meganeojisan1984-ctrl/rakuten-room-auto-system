import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { confirmLike, LIKE_CARD, LIKE_BUTTON } from "../src/actions/like-control";

test("observed ROOM card markup selects only the heart and never toggles it twice", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>.icon--19Vbv { display: inline-block; width: 16px; height: 16px; }</style>\n    <div class="container--JAywt collect--3N1ip">
      <button class="image-icon--2vI3U" id="heart" onclick="this.querySelector('div').className='icon--19Vbv rex-favorite-filled--2MJip'; this.dataset.clicks=Number(this.dataset.clicks || 0)+1">
        <div class="icon--19Vbv rex-favorite-outline--n4SWN"></div>
      </button>
      <button class="image-icon--2vI3U" id="share"><div class="rex-share--example"></div></button>
    </div>`);
    const buttons = page.locator(LIKE_CARD).locator(LIKE_BUTTON);
    assert.equal(await buttons.count(), 1);
    assert.equal(await confirmLike(buttons.first(), async () => {}), "liked");
    assert.equal(await confirmLike(buttons.first(), async () => {}), "already-liked");
    assert.equal(await page.locator("#heart").getAttribute("data-clicks"), "1");
    assert.equal(await page.locator("#share").getAttribute("data-clicks"), null);
  } finally {
    await browser.close();
  }
});
