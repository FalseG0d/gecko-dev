const { PanelTestProvider } = ChromeUtils.import(
  "resource://activity-stream/lib/PanelTestProvider.jsm"
);
const { MomentsPageHub } = ChromeUtils.import(
  "resource://activity-stream/lib/MomentsPageHub.jsm"
);
const { RemoteSettings } = ChromeUtils.import(
  "resource://services-settings/remote-settings.js"
);
const { ASRouter } = ChromeUtils.import(
  "resource://activity-stream/lib/ASRouter.jsm"
);

const HOMEPAGE_OVERRIDE_PREF = "browser.startup.homepage_override.once";

async function clearTestSetup() {
  // Wait to reset the WNPanel messages from state
  const previousMessageCount = ASRouter.state.messages.length;
  await BrowserTestUtils.waitForCondition(async () => {
    await ASRouter.loadMessagesFromAllProviders();
    return ASRouter.state.messages.length < previousMessageCount;
  }, "ASRouter messages should have been removed");
  await SpecialPowers.popPrefEnv();
  // Reload the provider
  await ASRouter._updateMessageProviders();
  // Pref set by the message
  Services.prefs.clearUserPref(HOMEPAGE_OVERRIDE_PREF);
}

add_task(async function test_with_rs_messages() {
  registerCleanupFunction(clearTestSetup);
  // Force the WNPanel provider cache to 0 by modifying updateCycleInMs
  await SpecialPowers.pushPrefEnv({
    set: [
      [
        "browser.newtabpage.activity-stream.asrouter.providers.whats-new-panel",
        `{"id":"cfr","enabled":true,"type":"remote-settings","bucket":"cfr","frequency":{"custom":[{"period":"daily","cap":200}]},"categories":["cfrAddons","cfrFeatures"],"updateCycleInMs":0}`,
      ],
    ],
  });
  const [msg] = (await PanelTestProvider.getMessages()).filter(
    ({ template }) => template === "update_action"
  );
  const initialMessageCount = ASRouter.state.messages.length;
  const client = RemoteSettings("cfr");
  const collection = await client.openCollection();
  await collection.clear();
  await collection.create(
    // Modify targeting and randomize message name to work around the message
    // getting blocked (for --verify)
    { ...msg, id: `MOMENTS_MOCHITEST_${Date.now()}`, targeting: "true" },
    { useRecordId: true }
  );
  await collection.db.saveLastModified(42); // Prevent from loading JSON dump.

  // Reload the provider
  await ASRouter._updateMessageProviders();
  // Wait to load the WNPanel messages
  await BrowserTestUtils.waitForCondition(async () => {
    await ASRouter.loadMessagesFromAllProviders();
    return ASRouter.state.messages.length > initialMessageCount;
  }, "Messages did not load");

  await MomentsPageHub.messageRequest({
    triggerId: "momentsUpdate",
    template: "update_action",
  });

  await BrowserTestUtils.waitForCondition(() => {
    return Services.prefs.getStringPref(HOMEPAGE_OVERRIDE_PREF, "").length;
  }, "Pref value was not set");

  let value = Services.prefs.getStringPref(HOMEPAGE_OVERRIDE_PREF, "");
  is(JSON.parse(value).url, msg.content.action.data.url, "Correct value set");

  // Insert a new message and test that priority override works as expected
  msg.content.action.data.url = "https://www.mozilla.org/#mochitest";
  await collection.create(
    // Modify targeting to ensure the messages always show up
    {
      ...msg,
      id: `MOMENTS_MOCHITEST_${Date.now()}`,
      priority: 2,
      targeting: "true",
    },
    { useRecordId: true }
  );

  // Reset so we can `await` for the pref value to be set again
  Services.prefs.clearUserPref(HOMEPAGE_OVERRIDE_PREF);

  let prevLength = ASRouter.state.messages.length;
  // Wait to load the messages
  await BrowserTestUtils.waitForCondition(async () => {
    await ASRouter.loadMessagesFromAllProviders();
    return ASRouter.state.messages.length > prevLength;
  }, "Messages did not load");

  await MomentsPageHub.messageRequest({
    triggerId: "momentsUpdate",
    template: "update_action",
  });

  await BrowserTestUtils.waitForCondition(() => {
    return Services.prefs.getStringPref(HOMEPAGE_OVERRIDE_PREF, "").length;
  }, "Pref value was not set");

  value = Services.prefs.getStringPref(HOMEPAGE_OVERRIDE_PREF, "");
  is(
    JSON.parse(value).url,
    msg.content.action.data.url,
    "Correct value set for higher priority message"
  );

  await collection.clear();
});
