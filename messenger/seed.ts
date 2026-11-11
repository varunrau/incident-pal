import { shoppers } from '../shared/demo-shoppers.js';
import type { ChatChannel } from './types.js';

// The chat history the server starts with. Each channel holds conversations from the past two
// weeks. A conversation starts at `time` on the day `daysAgo` days before today, and its messages
// follow a minute or a few apart.

type Line = [author: string, text: string];
type CustomerLine = [supportAuthor: string | null, text: string];

interface Conversation<T = Line> {
  daysAgo: number;
  time: string;
  lines: T[];
}

export interface SeedMessage {
  channel: string;
  author: string;
  text: string;
  at: number;
}

const MS_PER_MINUTE = 60_000;
const MINUTE_GAPS = [1, 2, 1, 3, 2, 4, 1, 2, 5, 1];

const channelHistory: Record<string, Conversation[]> = {
  'incident-response': [
    {
      daysAgo: 14, time: '11:30', lines: [
        ['Jon Reyes', 'On-call handoff: quiet week. One alert on checkout latency Tuesday night that cleared by itself.'],
        ['Maya Chen', 'Thanks. I’ll take on-call from here.'],
        ['Jon Reyes', 'The runbook links are pinned in this channel if you need them.'],
      ],
    },
    {
      daysAgo: 13, time: '14:06', lines: [
        ['Jon Reyes', 'Paging this channel: checkout errors jumped in the last 10 minutes. Mostly `CART_NOT_FOUND` on `/shop/checkout`.'],
        ['Maya Chen', 'Looking. Are these real expirations or carts we lost?'],
        ['Jon Reyes', 'Request logs show the carts were created 70 to 90 seconds before checkout. The TTL is 60 seconds.'],
        ['Maya Chen', 'So the carts are expiring before people pay. Did anything change on the client?'],
        ['Priya Shah', 'The mobile checkout redesign went to 50% this morning. It adds an address confirmation step before payment.'],
        ['Jon Reyes', 'That would do it. The extra step pushes people past a minute.'],
        ['Priya Shah', 'I’m rolling the redesign back to 0% now.'],
        ['Jon Reyes', 'Errors are back to baseline two minutes after the rollback. I’ll post an update in #global-incident-status.'],
        ['Maya Chen', 'Follow-up for me: make the cart expiry error say what happened so support can explain it.'],
      ],
    },
    {
      daysAgo: 12, time: '10:30', lines: [
        ['Jon Reyes', 'Postmortem notes for yesterday’s cart expirations are in the incident doc. Main action items: longer cart TTL for the redesign and an alert on `CART_NOT_FOUND` rate.'],
        ['Maya Chen', 'The error message now reads “The cart expired or has already been checked out.” Shipped this morning.'],
        ['Priya Shah', 'The redesign stays off until the TTL change lands.'],
      ],
    },
    {
      daysAgo: 7, time: '09:14', lines: [
        ['Alex Kim', 'Heads up, `/shop/products` is returning 404 `PRODUCT_NOT_FOUND` for some carts.'],
        ['Jon Reyes', 'Confirmed in the logs. It started at 09:02. Any deploys?'],
        ['Alex Kim', 'The inventory sync ran at 09:00. It looks like it renamed the notebook’s product ID to `field-notebook-v2`.'],
        ['Maya Chen', 'Checkout still expects `field-notebook`, so new carts fail.'],
        ['Alex Kim', 'Reverting the sync mapping and rerunning it.'],
        ['Jon Reyes', 'I’ll take incident lead. Alex owns the fix, and I’ll handle status updates.'],
        ['Alex Kim', 'Sync rerun finished. The product ID is back to `field-notebook`.'],
        ['Jon Reyes', 'Cart creation is succeeding again. Watching for 15 minutes before calling it resolved.'],
        ['Jon Reyes', 'Resolved. Total impact was about 12 minutes of failed cart creation.'],
        ['Alex Kim', 'I’ll add a check so the sync refuses to change product IDs without a migration.'],
      ],
    },
    {
      daysAgo: 4, time: '15:40', lines: [
        ['Jon Reyes', 'Reminder for incident drills: check **Feature flags** first. Its history shows every change and whether a person or Ampersand made it.'],
        ['Maya Chen', 'Agreed. Most of our recent changes ship behind flags, so turning one off is usually the fastest rollback.'],
        ['Priya Shah', 'Can we add the dashboard link to the incident template?'],
        ['Jon Reyes', 'Done. The template now links the request log dashboard and the flags page.'],
      ],
    },
    {
      daysAgo: 1, time: '16:20', lines: [
        ['Maya Chen', 'Heads up for on-call: **Strict payment validation** goes on in production this week. It checks the payment currency against the cart quote before we call the payment provider.'],
        ['Jon Reyes', 'What should we watch after it goes on?'],
        ['Maya Chen', 'Checkout error rate on `/shop/checkout`. If it climbs after the flag change, turn the flag off first and investigate after.'],
        ['Jon Reyes', 'Sounds good. Ping me before you flip it so I’m watching the dashboard.'],
        ['Maya Chen', 'Will do.'],
      ],
    },
  ],
  'global-incident-status': [
    {
      daysAgo: 14, time: '09:00', lines: [
        ['Jon Reyes', 'This channel is for customer-impact updates during incidents. Technical discussion goes in #incident-response.'],
        ['Priya Shah', 'Thanks. Should stakeholders post questions here too?'],
        ['Jon Reyes', 'Yes, questions are welcome. Responders will answer between updates.'],
      ],
    },
    {
      daysAgo: 3, time: '09:30', lines: [
        ['Jon Reyes', 'Weekly status: no incidents this week. Checkout error rate stayed under 0.1%.'],
        ['Alex Kim', 'Fulfillment shipped 412 orders this week with no lost parcels.'],
        ['Maya Chen', 'Payments had no provider issues.'],
        ['Priya Shah', 'Thanks all. It’s nice to have a quiet week.'],
        ['Jon Reyes', 'Next week’s change to watch is the payment validation rollout.'],
      ],
    },
    {
      daysAgo: 13, time: '14:12', lines: [
        ['Jon Reyes', '**Investigating:** Some customers can’t complete checkout. Their carts expire before payment. We’re looking into it.'],
        ['Priya Shah', 'Is this affecting all customers or just mobile?'],
        ['Jon Reyes', 'Mostly mobile customers in the new checkout flow. Desktop looks normal.'],
        ['Jon Reyes', '**Identified:** The new mobile checkout step made carts expire before payment. We rolled the change back.'],
        ['Jon Reyes', '**Monitoring:** Checkout errors are back to normal levels. We’re watching for another 30 minutes.'],
        ['Jon Reyes', '**Resolved:** Checkout is working normally. Customers who saw an expired cart can add the notebook again and check out.'],
        ['Alex Kim', 'Thanks Jon. I’ll let support know they can point customers to a fresh cart.'],
      ],
    },
    {
      daysAgo: 10, time: '11:00', lines: [
        ['Jon Reyes', '**Scheduled maintenance:** The payment provider will rotate API keys Thursday at 07:00. We don’t expect customer impact.'],
        ['Maya Chen', 'I’ll be online during the rotation in case checkout needs the old key back.'],
      ],
    },
    {
      daysAgo: 8, time: '07:25', lines: [
        ['Maya Chen', '**Completed:** The payment provider key rotation finished at 07:12. Checkout ran normally throughout.'],
      ],
    },
    {
      daysAgo: 7, time: '09:20', lines: [
        ['Jon Reyes', '**Investigating:** New carts fail to create because the product appears unavailable. Existing carts are unaffected.'],
        ['Priya Shah', 'Should we pause the onboarding email that links to the notebook?'],
        ['Jon Reyes', 'Yes, please pause it until we confirm the fix.'],
        ['Priya Shah', 'Paused.'],
        ['Jon Reyes', '**Identified:** An inventory sync changed the product’s ID. We’re reverting the change.'],
        ['Jon Reyes', '**Monitoring:** The product is available again and new carts are succeeding.'],
        ['Jon Reyes', '**Resolved:** Cart creation failed for about 12 minutes between 09:02 and 09:14. No orders were lost.'],
        ['Priya Shah', 'Onboarding email is back on.'],
      ],
    },
    {
      daysAgo: 5, time: '13:30', lines: [
        ['Jon Reyes', 'Weekly status: no open incidents. Both incident reviews are done. Action items are tracked in the incident doc.'],
        ['Alex Kim', 'The sync safeguard from the product ID incident shipped today.'],
        ['Maya Chen', 'The cart expiry alert is live too.'],
      ],
    },
    {
      daysAgo: 2, time: '10:05', lines: [
        ['Maya Chen', '**Upcoming change:** We’ll turn on stricter payment validation later this week. It runs behind a flag, so we can turn it off immediately if checkout is affected.'],
        ['Priya Shah', 'Will customers notice anything?'],
        ['Maya Chen', 'They shouldn’t. It only rejects payments whose currency doesn’t match the cart.'],
        ['Jon Reyes', 'I’ll post here if anything changes after it’s on.'],
      ],
    },
  ],
  'all-water-cooler': [
    {
      daysAgo: 14, time: '13:00', lines: [
        ['Priya Shah', 'Welcome back from vacation, Alex! How was Portugal?'],
        ['Alex Kim', 'Amazing. I ate my weight in pastéis de nata.'],
        ['Maya Chen', 'Photos please!'],
        ['Alex Kim', 'Posting some in the photo album now.'],
        ['Jon Reyes', 'That beach looks unreal.'],
      ],
    },
    {
      daysAgo: 13, time: '08:45', lines: [
        ['Maya Chen', 'Morning! Someone left a tin of shortbread in the kitchen. Thank you, whoever you are.'],
        ['Alex Kim', 'That was me. My aunt sends way too much every year.'],
        ['Priya Shah', 'Please thank your aunt from all of us.'],
      ],
    },
    {
      daysAgo: 11, time: '12:10', lines: [
        ['Jon Reyes', 'Lunch run to the taco place at 12:30. Who’s in?'],
        ['Priya Shah', 'Me!'],
        ['Alex Kim', 'In. Meet by the elevators?'],
        ['Maya Chen', 'I have a call until 12:45. Can someone grab me two al pastor?'],
        ['Jon Reyes', 'Got it.'],
      ],
    },
    {
      daysAgo: 9, time: '16:50', lines: [
        ['Priya Shah', 'Has anyone read anything good lately? I need a book for a long flight next month.'],
        ['Maya Chen', '“The Overstory.” It’s long but worth it.'],
        ['Jon Reyes', 'Anything by Becky Chambers if you want something lighter.'],
        ['Alex Kim', 'Seconding Becky Chambers. “A Psalm for the Wild-Built” is perfect for a plane.'],
        ['Priya Shah', 'Adding both to my list, thanks!'],
      ],
    },
    {
      daysAgo: 8, time: '09:30', lines: [
        ['Alex Kim', 'The new field notebooks arrived at the office. Grab one from the shelf by the printer if you want one.'],
        ['Maya Chen', 'The grid paper is so nice.'],
        ['Jon Reyes', 'Taking one for incident notes. Very on brand.'],
      ],
    },
    {
      daysAgo: 6, time: '17:15', lines: [
        ['Priya Shah', 'Any weekend plans?'],
        ['Jon Reyes', 'Hiking if the rain holds off.'],
        ['Maya Chen', 'My sister is visiting, so lots of eating.'],
        ['Alex Kim', 'Building a bookshelf. Wish me luck.'],
        ['Priya Shah', 'Post a picture of the bookshelf on Monday!'],
      ],
    },
    {
      daysAgo: 3, time: '09:05', lines: [
        ['Alex Kim', 'Bookshelf report: it stands, and it only leans a little.'],
        ['Jon Reyes', 'A little lean adds character.'],
        ['Maya Chen', 'Coffee machine is fixed, by the way. It just needed descaling.'],
        ['Priya Shah', 'Best news of the week.'],
      ],
    },
    {
      daysAgo: 1, time: '15:00', lines: [
        ['Jon Reyes', 'Coffee in the kitchen if anyone needs a refill.'],
        ['Priya Shah', 'Thanks! I’ll swing by after standup.'],
        ['Maya Chen', 'Is that the new roast? It smells great.'],
        ['Jon Reyes', 'Yes, from the place on 5th. Let me know what you think.'],
      ],
    },
  ],
  'eng-core-payments': [
    {
      daysAgo: 14, time: '15:20', lines: [
        ['Jon Reyes', 'The provider’s sandbox has been flaky today. Two test runs timed out.'],
        ['Maya Chen', 'Their status page shows degraded sandbox performance. Production is fine.'],
        ['Jon Reyes', 'OK, I’ll rerun the tests tomorrow.'],
      ],
    },
    {
      daysAgo: 13, time: '11:20', lines: [
        ['Maya Chen', 'Starting the design for strict payment validation. The idea is to check the payment currency against the currency quoted on the cart before calling the provider.'],
        ['Jon Reyes', 'What happens on a mismatch today?'],
        ['Maya Chen', 'The provider accepts it, and we find the mismatch later during reconciliation. It’s rare, but cleaning it up is painful.'],
        ['Jon Reyes', 'Makes sense. Please ship it behind a flag.'],
        ['Maya Chen', 'Definitely. It’ll be `strict_payment_validation`, off by default.'],
      ],
    },
    {
      daysAgo: 11, time: '14:45', lines: [
        ['Maya Chen', 'Euro checkout has been live for two weeks now. EUR orders are about a third of volume.'],
        ['Priya Shah', 'That’s higher than we expected. French traffic from the newsletter is doing well.'],
        ['Maya Chen', 'The cart stores the currency the shopper picked, and checkout charges in that currency.'],
      ],
    },
    {
      daysAgo: 9, time: '10:10', lines: [
        ['Maya Chen', 'PR for strict payment validation is up. The cart quote is the source of truth for currency.'],
        ['Jon Reyes', 'Reviewing now.'],
        ['Jon Reyes', 'Looks good. What error does the shopper get when validation fails?'],
        ['Maya Chen', 'A 502 with `PAYMENT_PROVIDER_REJECTED`, which is the same response the shopper gets when the provider declines.'],
        ['Jon Reyes', 'Should we use a more specific code so we can tell them apart in the logs?'],
        ['Maya Chen', 'Good idea, but I want to keep the client contract stable for now. I’ll add a ticket for a separate code.'],
        ['Jon Reyes', 'Approved.'],
      ],
    },
    {
      daysAgo: 8, time: '07:05', lines: [
        ['Maya Chen', 'Provider key rotation starting. I’ll watch checkout for the next 15 minutes.'],
        ['Maya Chen', 'Rotation done. No errors and checkout latency is unchanged.'],
      ],
    },
    {
      daysAgo: 6, time: '13:15', lines: [
        ['Jon Reyes', 'Checkout p95 latency is about 120 ms, steady all week.'],
        ['Maya Chen', 'Nice. The provider’s sandbox was slower last month, so it’s good to see production steady.'],
        ['Jon Reyes', 'Order receipts have been on for everyone since last Tuesday with no issues.'],
      ],
    },
    {
      daysAgo: 4, time: '11:00', lines: [
        ['Maya Chen', 'Strict payment validation is merged and deployed with the flag off.'],
        ['Jon Reyes', 'What’s the rollout plan?'],
        ['Maya Chen', 'Turn it on in production later this week and watch checkout errors for an hour. If errors climb, turn it off.'],
        ['Jon Reyes', 'Do we have a dashboard for it?'],
        ['Maya Chen', 'The request log dashboard covers it. Filter to errors and look at `/shop/checkout`.'],
      ],
    },
    {
      daysAgo: 2, time: '16:30', lines: [
        ['Jon Reyes', 'Checkout smoke tests passed this morning. Browse, cart, and payment all returned 2xx.'],
        ['Maya Chen', 'Thanks. I’ll check the payment logs after the next test run.'],
        ['Maya Chen', 'Payment logs look clean. Both USD and EUR orders are going through.'],
        ['Jon Reyes', 'Great. I think we’re ready for the strict validation rollout.'],
        ['Maya Chen', 'I’ll post in #incident-response before I turn it on.'],
      ],
    },
  ],
  'eng-growth': [
    {
      daysAgo: 14, time: '10:30', lines: [
        ['Priya Shah', 'Planning next month’s experiments. Ideas welcome.'],
        ['Alex Kim', 'A gift option at checkout? Support gets asked about gifts a lot.'],
        ['Maya Chen', 'Showing prices in the shopper’s currency on the product page.'],
        ['Priya Shah', 'Both good. I’ll write them up.'],
        ['Jon Reyes', 'Please keep experiments behind flags so on-call can turn them off.'],
      ],
    },
    {
      daysAgo: 13, time: '10:00', lines: [
        ['Priya Shah', 'The mobile checkout redesign is at 50% as of this morning.'],
        ['Alex Kim', 'Exciting! What are we measuring?'],
        ['Priya Shah', 'Checkout completion rate, and time from cart to payment.'],
        ['Priya Shah', 'Update: I rolled it back because of the cart expirations. See #incident-response.'],
        ['Alex Kim', 'Oof. At least we caught it quickly.'],
      ],
    },
    {
      daysAgo: 11, time: '15:30', lines: [
        ['Priya Shah', 'The redesign comes back once the cart TTL change ships. Until then, I’m testing onboarding copy.'],
        ['Maya Chen', 'What’s the copy test?'],
        ['Priya Shah', '“Start your field notes” vs “Get your notebook.” The first one sounds friendlier to me.'],
        ['Jon Reyes', 'I’d click “Start your field notes.”'],
      ],
    },
    {
      daysAgo: 9, time: '11:45', lines: [
        ['Priya Shah', 'Newsletter traffic from France doubled after last week’s send.'],
        ['Maya Chen', 'That matches the EUR order volume we’re seeing.'],
        ['Priya Shah', 'Should we translate the onboarding email?'],
        ['Maya Chen', 'I can review a French draft.'],
        ['Priya Shah', 'Thank you! I’ll send it over tomorrow.'],
      ],
    },
    {
      daysAgo: 7, time: '09:22', lines: [
        ['Priya Shah', 'Pausing the onboarding email during the product ID incident.'],
        ['Priya Shah', 'Resumed. It was paused for about 20 minutes.'],
      ],
    },
    {
      daysAgo: 5, time: '14:00', lines: [
        ['Priya Shah', 'The cart item details flag is ready for the mobile cart experiment. It adds the product and quantity to cart responses.'],
        ['Alex Kim', 'Will it change the cart payload size much?'],
        ['Priya Shah', 'Barely. It’s one item with a name, price, and quantity.'],
        ['Jon Reyes', 'Is it on anywhere yet?'],
        ['Priya Shah', 'No, it stays off until design signs off on the new cart screen.'],
      ],
    },
    {
      daysAgo: 3, time: '10:40', lines: [
        ['Priya Shah', 'The onboarding copy experiment is ready for a review.'],
        ['Alex Kim', 'I’ll check the mobile flow this afternoon.'],
        ['Alex Kim', 'Mobile flow looks good. One typo on the second screen: “notbook.”'],
        ['Priya Shah', 'Ha, fixed. Thanks!'],
        ['Priya Shah', 'Early results: “Start your field notes” is ahead by about 4% on click-through.'],
        ['Maya Chen', 'Nice. How long will it run?'],
        ['Priya Shah', 'Two weeks, then I’ll share the full results here.'],
      ],
    },
  ],
  'eng-fulfillment': [
    {
      daysAgo: 14, time: '16:15', lines: [
        ['Alex Kim', 'The printer confirmed the next notebook batch. They’re switching to a recycled cover stock.'],
        ['Priya Shah', 'Nice, that’s a good story for the newsletter.'],
        ['Alex Kim', 'I’ll send you photos when the samples arrive.'],
      ],
    },
    {
      daysAgo: 13, time: '09:00', lines: [
        ['Alex Kim', 'Field notebooks are backordered. The next shipment from the printer arrives Friday.'],
        ['Jon Reyes', 'Should we hide the product until then?'],
        ['Alex Kim', 'No, we’ll keep taking orders and ship them when stock arrives. Support knows.'],
      ],
    },
    {
      daysAgo: 10, time: '13:20', lines: [
        ['Alex Kim', 'Shipment arrived: 2,000 field notebooks. Inventory sync is running.'],
        ['Alex Kim', 'Inventory sync finished. The field notebook is available for checkout.'],
        ['Jon Reyes', 'Thanks. The fulfillment job still starts when checkout creates an order.'],
        ['Alex Kim', 'Correct. Backorders ship first, then new orders in order.'],
      ],
    },
    {
      daysAgo: 9, time: '16:00', lines: [
        ['Alex Kim', 'All backorders are packed. The carrier picks up tomorrow at 10:00.'],
        ['Priya Shah', 'How many backorders were there?'],
        ['Alex Kim', '184. About a third were going to Europe.'],
      ],
    },
    {
      daysAgo: 7, time: '10:15', lines: [
        ['Alex Kim', 'Post-incident note: the inventory sync changed the product ID because the printer’s spreadsheet used a new SKU.'],
        ['Jon Reyes', 'Can we pin the product ID so the sync can’t change it?'],
        ['Alex Kim', 'Yes. The sync will match on SKU and refuse to change product IDs without a migration.'],
        ['Jon Reyes', 'Perfect.'],
      ],
    },
    {
      daysAgo: 5, time: '11:30', lines: [
        ['Alex Kim', 'The sync safeguard shipped. I tested it with the new spreadsheet, and the product ID stayed `field-notebook`.'],
        ['Maya Chen', 'Great work.'],
        ['Alex Kim', 'Carrier scans are slower this week. Tracking takes up to a day to update after pickup.'],
        ['Jon Reyes', 'Worth telling support so they can set expectations.'],
        ['Alex Kim', 'Already posted in the customer channels.'],
      ],
    },
    {
      daysAgo: 3, time: '14:10', lines: [
        ['Alex Kim', 'Weekly numbers: 412 orders shipped, 3 returns, no lost parcels.'],
        ['Priya Shah', 'What were the returns for?'],
        ['Alex Kim', 'Two duplicate orders and one damaged corner. We replaced the damaged one.'],
        ['Maya Chen', 'Do we know why the duplicates happened?'],
        ['Alex Kim', 'Customers clicked checkout twice on slow connections. The receipts show two separate orders.'],
        ['Maya Chen', 'I’ll look at making checkout safe to retry.'],
      ],
    },
    {
      daysAgo: 1, time: '10:45', lines: [
        ['Alex Kim', 'Stock check: 1,540 field notebooks left. That’s about four weeks at the current rate.'],
        ['Jon Reyes', 'When do we reorder?'],
        ['Alex Kim', 'I’ll place the next printer order at 1,000 units remaining.'],
        ['Priya Shah', 'The France newsletter might speed that up. I’ll share the send date.'],
        ['Alex Kim', 'Thanks, that helps me plan.'],
      ],
    },
  ],
};

// `null` marks a message from the customer the channel belongs to.
const customerHistory: Record<(typeof shoppers)[number]['id'], Conversation<CustomerLine>[]> = {
  'shopper-01': [
    {
      daysAgo: 14, time: '17:30', lines: [
        [null, 'Hi, do you have a size guide for the notebook?'],
        ['Alex Kim', 'Sure! It’s A5, so about 5.8 by 8.3 inches, with 120 grid pages.'],
        [null, 'Perfect, thanks.'],
      ],
    },
    {
      daysAgo: 13, time: '10:15', lines: [
        [null, 'Hi! Is the field notebook back in stock? I wanted to order one for a weekend trip.'],
        ['Alex Kim', 'Hi Dana! It’s backordered right now. The next shipment arrives Friday.'],
        [null, 'Can I still order it today?'],
        ['Alex Kim', 'Yes. Backorders ship first when stock arrives.'],
        [null, 'Great, I’ll order now. My trip is the weekend after next, so that should work.'],
      ],
    },
    {
      daysAgo: 10, time: '14:00', lines: [
        ['Alex Kim', 'Good news, Dana: the shipment arrived, and backorders go out tomorrow.'],
        [null, 'Perfect timing, thank you for letting me know!'],
      ],
    },
    {
      daysAgo: 9, time: '18:20', lines: [
        [null, 'I got the shipping email, but the tracking page says “label created.”'],
        ['Alex Kim', 'That’s normal until the carrier scans it at pickup tomorrow morning.'],
        [null, 'Got it. I’ll check again tomorrow.'],
      ],
    },
    {
      daysAgo: 7, time: '11:05', lines: [
        [null, 'It arrived! The grid paper is lovely.'],
        ['Alex Kim', 'So glad you like it! Enjoy the trip.'],
        [null, 'One question: can I order a second one as a gift and have it shipped to a different address?'],
        ['Alex Kim', 'Yes. Enter the gift address at checkout. The receipt doesn’t show prices on the packing slip.'],
        [null, 'Amazing. Ordering now.'],
      ],
    },
    {
      daysAgo: 6, time: '09:40', lines: [
        [null, 'I placed the gift order from my phone and got the receipt.'],
        ['Alex Kim', 'Glad it went through. You’ll get a separate email when it ships.'],
        [null, 'Oops, I typed the wrong apartment number on the gift order. Can you fix it?'],
        ['Alex Kim', 'Sure. What’s the correct apartment number?'],
        [null, '4B, not 4D.'],
        ['Alex Kim', 'Updated to 4B. It hasn’t shipped yet, so it’ll go to the right place.'],
        [null, 'Thank you so much!'],
      ],
    },
    {
      daysAgo: 3, time: '16:30', lines: [
        [null, 'My friend got the gift notebook today. She loves it.'],
        ['Alex Kim', 'That’s great to hear!'],
        [null, 'Any chance you’ll sell a pocket size?'],
        ['Alex Kim', 'Not yet, but I’ll pass that along to the team. You’re not the first to ask.'],
        [null, 'I’d buy three. Thanks Alex!'],
      ],
    },
    {
      daysAgo: 1, time: '12:15', lines: [
        [null, 'Quick one: do you ship to Canada?'],
        ['Alex Kim', 'Not yet. We ship to the US and the EU right now.'],
        [null, 'OK, I’ll keep sending gifts to my US friends then.'],
      ],
    },
  ],
  'shopper-02': [
    {
      daysAgo: 14, time: '10:40', lines: [
        [null, 'Bonjour, est-ce que le papier convient à l’aquarelle ?'],
        ['Maya Chen', 'Bonjour ! Le papier est assez épais pour l’encre et le crayon, mais il gondole un peu avec beaucoup d’eau.'],
        [null, 'D’accord, merci pour la réponse honnête.'],
        ['Maya Chen', 'Avec plaisir !'],
      ],
    },
    {
      daysAgo: 12, time: '09:30', lines: [
        [null, 'Bonjour ! Mon panier affiche des euros. Le reçu sera-t-il aussi en euros ?'],
        ['Maya Chen', 'Bonjour Élodie ! Oui, le reçu utilise la devise affichée au moment du paiement.'],
        [null, 'Parfait. Et la TVA est incluse dans le prix ?'],
        ['Maya Chen', 'Oui, le prix affiché inclut la TVA.'],
        [null, 'Merci. Je viens de finaliser ma commande et le reçu indique bien le montant attendu.'],
        ['Maya Chen', 'Parfait. N’hésitez pas à nous écrire sur ce canal si vous avez besoin d’une copie plus tard.'],
      ],
    },
    {
      daysAgo: 10, time: '15:10', lines: [
        [null, 'Est-ce que vous livrez à Lyon ?'],
        ['Maya Chen', 'Oui, nous livrons partout en France. Le délai habituel est de 5 à 7 jours ouvrés.'],
        [null, 'Très bien, merci.'],
      ],
    },
    {
      daysAgo: 8, time: '10:00', lines: [
        [null, 'J’ai besoin d’une facture avec le nom de mon entreprise pour une note de frais. C’est possible ?'],
        ['Maya Chen', 'Bien sûr. Quel nom et quelle adresse dois-je indiquer ?'],
        [null, 'Atelier Martin, 12 rue de la République, 69002 Lyon.'],
        ['Maya Chen', 'C’est noté. Je vous envoie la facture par e-mail aujourd’hui.'],
        [null, 'Reçue, merci beaucoup !'],
      ],
    },
    {
      daysAgo: 6, time: '11:45', lines: [
        [null, 'Le suivi indique que le colis est arrivé en France, mais il ne bouge plus depuis deux jours.'],
        ['Maya Chen', 'Les scans du transporteur sont plus lents cette semaine. Le suivi peut avoir un jour de retard.'],
        [null, 'D’accord, j’attends encore un peu.'],
        [null, 'C’est arrivé ce matin !'],
        ['Maya Chen', 'Super, merci de nous avoir prévenus.'],
      ],
    },
    {
      daysAgo: 4, time: '14:20', lines: [
        [null, 'Mes collègues veulent aussi des carnets. Est-ce qu’il y a un tarif pour plusieurs exemplaires ?'],
        ['Maya Chen', 'Pas encore de tarif dégressif, mais chaque carnet peut être commandé séparément.'],
        [null, 'D’accord. Je vais commander pour toute l’équipe la semaine prochaine.'],
        ['Maya Chen', 'Merci ! Écrivez-nous si vous voulez une seule facture pour l’ensemble.'],
        [null, 'Ce serait parfait, oui.'],
      ],
    },
    {
      daysAgo: 2, time: '09:50', lines: [
        [null, 'Petite question : est-ce que je peux payer en dollars si je préfère ?'],
        ['Maya Chen', 'Vous pouvez choisir la devise au moment de créer le panier. Le paiement se fait ensuite dans cette devise.'],
        [null, 'Je vais rester en euros, c’est plus simple pour la comptabilité.'],
        ['Maya Chen', 'Très bien. Bonne journée !'],
        [null, 'Merci, à vous aussi.'],
      ],
    },
  ],
  'shopper-03': [
    {
      daysAgo: 14, time: '20:10', lines: [
        [null, 'Are the pages numbered?'],
        ['Priya Shah', 'They aren’t numbered, but there’s an index page at the front.'],
        [null, 'Good enough for me, thanks!'],
        ['Priya Shah', 'Happy to help.'],
      ],
    },
    {
      daysAgo: 13, time: '13:55', lines: [
        [null, 'I left a notebook in my cart this morning and it was gone when I came back.'],
        ['Priya Shah', 'Inactive carts expire. Add the notebook again to get a fresh cart.'],
        [null, 'Got it, but now checkout says my cart expired, even though I just made it.'],
        ['Priya Shah', 'Sorry about that, Jordan. We had a problem with mobile checkout this afternoon, and it’s fixed now. Could you try again?'],
        [null, 'I added it again and the new order went through.'],
        ['Priya Shah', 'Thanks for checking. Your order confirmation should be in your inbox.'],
      ],
    },
    {
      daysAgo: 11, time: '10:30', lines: [
        [null, 'Do you have discount codes for students?'],
        ['Priya Shah', 'Not right now, but we’re looking at it for the fall.'],
        [null, 'Cool, I’ll keep an eye out.'],
      ],
    },
    {
      daysAgo: 9, time: '17:40', lines: [
        [null, 'My order says shipped but the tracking number doesn’t work on the carrier site.'],
        ['Priya Shah', 'The carrier’s site can take a few hours to recognize new numbers. Could you try again tonight?'],
        [null, 'Works now. It says out for delivery Thursday.'],
        ['Priya Shah', 'Great!'],
      ],
    },
    {
      daysAgo: 7, time: '09:18', lines: [
        [null, 'I tried to order another notebook and the site says the product is unavailable?'],
        ['Priya Shah', 'We had a short problem with product availability this morning. It should be fixed in a few minutes.'],
        [null, 'Yep, it works now. Order placed.'],
        ['Priya Shah', 'Thanks for your patience!'],
      ],
    },
    {
      daysAgo: 5, time: '19:05', lines: [
        [null, 'Got both notebooks. The second one has a small dent in the corner.'],
        ['Priya Shah', 'Sorry about that! Could you send a photo? We’ll ship a replacement.'],
        [null, 'Sent it to support email just now.'],
        ['Priya Shah', 'Got it. The replacement ships tomorrow, and you can keep the dented one.'],
        [null, 'That’s really generous, thanks!'],
      ],
    },
    {
      daysAgo: 2, time: '11:25', lines: [
        [null, 'Replacement arrived in perfect shape.'],
        ['Priya Shah', 'Glad to hear it!'],
        [null, 'One more thing: can I get receipts for both orders in one email? It’s for a class reimbursement.'],
        ['Priya Shah', 'Sure. I’ll send both receipts to the email on your account today.'],
        [null, 'Perfect, thank you.'],
        ['Priya Shah', 'Sent! Let us know if your school needs anything else on them.'],
        [null, 'Will do.'],
      ],
    },
  ],
  'shopper-04': [
    {
      daysAgo: 14, time: '11:50', lines: [
        [null, 'Hola! Do you ship to Spain?'],
        ['Jon Reyes', 'Hi Sam, yes, we ship everywhere in the EU.'],
        [null, 'How long does it usually take to Madrid?'],
        ['Jon Reyes', 'Usually 5 to 7 business days.'],
        [null, 'Great, thank you.'],
      ],
    },
    {
      daysAgo: 12, time: '16:10', lines: [
        [null, 'Hi, I see prices in euros. Is that the final price, or will my bank add conversion fees?'],
        ['Jon Reyes', 'Hi Sam! You pay in euros, so there’s no conversion on our side. Your bank may charge a fee if your card is in another currency.'],
        [null, 'My card is in euros, so that’s fine. Thanks!'],
      ],
    },
    {
      daysAgo: 10, time: '12:30', lines: [
        [null, 'I got a receipt, but the tracking page hasn’t updated yet.'],
        ['Jon Reyes', 'Tracking starts updating after the carrier scans the parcel. The receipt confirms we received the order.'],
        [null, 'It updated this afternoon. Thanks for explaining the difference.'],
        ['Jon Reyes', 'Glad it’s moving. The tracking page will show the delivery estimate.'],
      ],
    },
    {
      daysAgo: 8, time: '09:15', lines: [
        [null, 'The parcel arrived in Madrid today. Very quick!'],
        ['Jon Reyes', 'Great to hear!'],
        [null, 'I want to order five more for my team. Is there a limit per order?'],
        ['Jon Reyes', 'There’s no hard limit, but each checkout is one notebook right now. You can place five orders.'],
        [null, 'That’s a bit tedious, but OK.'],
        ['Jon Reyes', 'I know, sorry. Multi-item carts are on our list.'],
      ],
    },
    {
      daysAgo: 6, time: '14:45', lines: [
        [null, 'I placed the five orders. Four went through, but the fifth one says the cart expired.'],
        ['Jon Reyes', 'Carts expire after a minute of inactivity. Could you start a new cart for the fifth one?'],
        [null, 'Done, it worked this time.'],
        ['Jon Reyes', 'Thanks Sam. All five orders will ship together if they’re going to the same address.'],
        [null, 'Same address, yes. Perfect.'],
      ],
    },
    {
      daysAgo: 4, time: '10:20', lines: [
        [null, 'Four parcels arrived and one is still in transit. Is that normal?'],
        ['Jon Reyes', 'They sometimes split at the carrier’s depot. The fifth one should arrive within a day or two.'],
        [null, 'It just arrived. All five here!'],
        ['Jon Reyes', 'Excellent. Enjoy them!'],
      ],
    },
    {
      daysAgo: 2, time: '15:35', lines: [
        [null, 'My team loves them. Do you sell refill paper?'],
        ['Jon Reyes', 'Not yet, but I’ll pass the request on. Refills come up a lot.'],
        [null, 'Please do. I’d subscribe to refills in a heartbeat.'],
        ['Jon Reyes', 'Noted. I’ll let you know if we launch them.'],
        [null, 'Thanks Jon, great service as always.'],
        ['Jon Reyes', 'Happy to help!'],
      ],
    },
  ],
};

function customerChannelId(name: string) {
  const slug = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `customer-${slug}`;
}

export const seedChannels: ChatChannel[] = [
  { id: 'incident-response', topic: 'Technical discussion for responders' },
  { id: 'global-incident-status', topic: 'Updates on impact and recovery for stakeholders' },
  { id: 'all-water-cooler', topic: 'General workspace conversation' },
  { id: 'eng-core-payments', topic: 'Checkout and payment engineering' },
  { id: 'eng-growth', topic: 'Growth experiments and onboarding' },
  { id: 'eng-fulfillment', topic: 'Orders, inventory, and fulfillment' },
  ...shoppers.map(({ id, name }) => ({ id: customerChannelId(name), topic: `Customer support for ${name} · ${id}` })),
];

function expand(channel: string, conversations: Conversation[], now: Date): SeedMessage[] {
  return conversations.flatMap(({ daysAgo, time, lines }) => {
    const [hours, minutes] = time.split(':').map(Number);
    const start = new Date(now);
    start.setDate(start.getDate() - daysAgo);
    start.setHours(hours, minutes, 0, 0);
    let at = start.getTime();
    return lines.map(([author, text], index) => {
      if (index) at += MINUTE_GAPS[index % MINUTE_GAPS.length] * MS_PER_MINUTE;
      return { channel, author, text, at };
    });
  });
}

// Every seed message in time order, dated relative to `now`.
export function seedMessages(now = new Date()): SeedMessage[] {
  const customers = shoppers.map(({ id, name }) => expand(
    customerChannelId(name),
    customerHistory[id].map(({ lines, ...rest }) => ({ ...rest, lines: lines.map(([author, text]): Line => [author ?? name, text]) })),
    now,
  ));
  return [
    ...Object.entries(channelHistory).flatMap(([channel, conversations]) => expand(channel, conversations, now)),
    ...customers.flat(),
  ].sort((a, b) => a.at - b.at);
}
