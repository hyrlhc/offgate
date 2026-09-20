// Dil — varsayilan INGILIZCE.
//
// Juri ve ekosistem agirlikli Ingilizce okuyor; Turkce ikinci dil olarak
// ust cubuktaki anahtarla aciliyor. Secim localStorage'da kaliyor.
//
// Kucuk bir depo kullaniyoruz (`useSyncExternalStore`) cunku dil degisince
// sayfanin yeniden yuklenmesini istemiyoruz — profil anahtarindan farkli
// olarak burada yeniden yuklemeyi gerektiren bir modul sabiti yok.

import { useSyncExternalStore } from 'react';

export type Lang = 'en' | 'tr';

const KEY = 'offgate.lang';
const listeners = new Set<() => void>();

function read(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'tr' || saved === 'en') return saved;
  } catch { /* gizli sekme — varsayilana dus */ }
  return 'en';
}

let current: Lang = typeof localStorage === 'undefined' ? 'en' : read();

// `<html lang>` acilista da dogru olmali. Yalnizca erisilebilirlik icin degil:
// `text-transform: uppercase`, Turkce yerelinde `i` harfini `İ` yapiyor —
// lang="tr" kalirsa Ingilizce basliklar "RİSE", "GENESİS", "CONTRİBUTE"
// diye cikiyor. Bu hata ekranda gorulene kadar fark edilmiyor.
try { document.documentElement.lang = current; } catch { /* SSR / test */ }

export function setLang(next: Lang) {
  current = next;
  try { localStorage.setItem(KEY, next); } catch { /* yoksay */ }
  try { document.documentElement.lang = next; } catch { /* yoksay */ }
  listeners.forEach((fn) => fn());
}

export const getLang = () => current;

export function useLang(): Lang {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => current,
    () => 'en' as Lang,
  );
}

/** Sayi ve para bicimi de dile bagli; yoksa Ingilizce ekranda Turkce ayrac kalir. */
export const locale = () => (current === 'tr' ? 'tr-TR' : 'en-US');

type Dict = Record<string, string>;

/**
 * Sozluk. Anahtarlar Ingilizce metnin kisaltmasi degil, ANLAMIN adi —
 * metin degisince anahtar degismesin diye.
 */
const EN: Dict = {
  'nav.demo': 'Demo',
  'nav.how': 'How it works',
  'nav.carry': 'Carry data',
  'nav.audit': 'Audit',
  'nav.testnet': 'testnet',
  'profile.live': 'Anchor',
  'profile.local': 'Fallback',
  'profile.tipLive': 'Live anchor (SEP-1/10/38/6). Switch to fallback if the anchor stops paying out.',
  'profile.tipLocal': 'Fallback mode: our own test asset, separate contract. Click to return to the live anchor.',

  'stage.title': 'Passage continues when the internet does not.',
  'stage.sub': 'Load lira, lock it on chain, pass offline.',
  'stage.more': 'How it works →',
  'stage.foot': 'Stellar Testnet · no real money moves',
  'stage.lastTicket': 'last ticket: gate {gate}',

  'flow.intro': 'Load a balance that works inside the venue. Pass without internet.',
  'flow.connect': 'Connect wallet',
  'flow.connectNote': 'Freighter, Lobstr, Albedo and others — Stellar Wallets Kit.',
  'flow.wristband': 'No wallet — give me an event wristband',
  'flow.connecting': 'Connecting…',
  'flow.whichGate': 'Which gate will you use?',
  'flow.openTickets': '{n} open tickets',
  'flow.full': 'currently full',
  'flow.gatesLoading': 'Reading gates from the chain…',
  'flow.noGates': 'No gates registered for this event.',
  'flow.fare': 'Fare',
  'flow.deposit': 'Deposit',
  'flow.event': 'Event',
  'flow.pay': 'Pay {amount} — {gate}',
  'flow.working': 'Working…',
  'flow.passes': 'passes',
  'flow.feeLine': '+ {fee} deposit = {total}',
  'flow.feeLabel': 'Deposit',
  'flow.feeBack': '5% — carry the gate data and {amount} comes back',

  'ticket.passes': 'passes',
  'ticket.code': 'Ticket code',
  'ticket.codeNote': 'Unique to this ticket. Wallet, gate, amount and expiry are inside this digest.',
  'ticket.owner': 'Owner',
  'ticket.deviceKey': 'Your signing key',
  'ticket.deviceNote': 'The gate verifies every receipt against this key — a receipt signed by anyone else is refused.',
  'ticket.rate': 'Locked rate',
  'ticket.paid': 'Paid',
  'ticket.bankRef': 'Bank reference',
  'ticket.copy': 'Go to the gate — copy the ticket',
  'ticket.copied': 'Copied ✓',
  'ticket.note': 'Receipts are already signed. No internet needed at the gate. This text is a bearer instrument — whoever copies it can use it, think of it as an event wristband.',
  'ticket.raw': 'Raw bundle ({n} characters)',
  'ticket.lockTx': 'Lock transaction ↗',
  'ticket.carryCta': 'Passed through a gate? Carry the data, get your money back →',

  'carry.eyebrow': 'Contribute to the network',
  'carry.title': 'Carry the gate data on chain',
  'carry.lead': 'When you passed through, the gate handed you a signed collection voucher. The contract verifies the signature really belongs to that turnstile and gives your money back.',
  'carry.whyTitle': 'Why you carry it',
  'carry.change': 'Change',
  'carry.changeBody': 'If the gate charged less, the difference stays in your balance.',
  'carry.rebate': 'Deposit refund',
  'carry.rebateBody': 'For every pass you carry, 80% of the 5% deposit returns to your wallet.',
  'carry.refundable': 'Refund headroom',
  'carry.refundableBody': 'The outstanding pass closes, so the amount you can withdraw grows.',
  'carry.feeNote': 'The transaction fee on Stellar is under a cent — that is why a micro-reward like this makes sense here.',
  'carry.pasteTitle': 'Paste the data',
  'carry.placeholder': 'Paste the text you copied on the gate page…',
  'carry.wallet': 'Wallet',
  'carry.colGate': 'Gate',
  'carry.colReceipt': 'Receipt',
  'carry.colCharged': 'Charged',
  'carry.colBack': 'Back to you',
  'carry.totalBack': 'Total refund',
  'carry.alsoReport': 'the gate declaration will be carried too (counter {n})',
  'carry.submit': 'Write on chain and collect',
  'carry.submitting': 'Writing on chain…',
  'carry.connectFirst': 'Connect your wallet first.',
  'carry.doneTitle': 'Done',
  'carry.donePasses': 'Passes written on chain',
  'carry.doneRebate': 'Deposit returned to your wallet',
  'carry.doneRefundable': 'Amount you can withdraw',
  'carry.doneNote': 'The gate data is on chain now. The operator did not have to run settlement — you did, and you were paid for it.',

  'audit.eyebrow': 'Event {event}',
  'audit.title': 'Audit',
  'audit.lead': 'The gate’s own declaration next to the on-chain record.',
  'audit.gates': 'Gates',
  'audit.loading': 'Reading from the chain…',
  'audit.none': 'No gates registered.',
  'audit.colGate': 'Gate',
  'audit.colDeclared': 'Declared',
  'audit.colChain': 'On chain',
  'audit.colDiff': 'Diff',
  'audit.colLoad': 'Load',
  'audit.missing': '{n} missing',
  'audit.behind': 'declaration {n} behind',
  'audit.total': 'Total',
  'audit.totalDeclared': 'Declared passes',
  'audit.totalChain': 'Receipts on chain',
  'audit.revenue': 'Revenue',
  'audit.refresh': 'Refresh',
  'flow.waiting': 'Waiting…',
  'flow.savedBand': 'There is a wristband saved in this browser:',
  'flow.thisIsMe': 'That’s me, continue',
  'flow.notMe': 'I’m someone else',
  'flow.howMany': 'How many passes?',
  'flow.minus': 'One fewer',
  'flow.plus': 'One more',
  'flow.loading': 'Loading…',
  'flow.addAmount': 'Add {amount}',
  'flow.pickGate': 'Pick a gate',
  'flow.openTicket': 'You have an open ticket on chain.',
  'flow.openTicketBody': 'A top-up goes to the same gate at the same locked rate: {gate}, 1 USDC = {rate} TRY. {used} of the {granted} signed passes have reached the chain.',
  'flow.closeTicket': 'Close the ticket, return the remaining balance to my wallet',
  'steps.gate': 'Gate chosen',
  'steps.trustline': '{asset} trustline',
  'steps.auth': 'Wallet authenticated',
  'steps.quote': 'Rate locked',
  'steps.deposit': 'Payment instruction received',
  'steps.bank': 'Bank transfer received',
  'steps.settled': '{asset} credited to your account',
  'steps.lock': 'Balance locked on chain',
  'steps.entitlement': 'Ticket signed',
  'steps.book': 'Pass receipts prepared',
  'steps.entitlementNote': 'verified against the chain',
  'ticket.clipboardFail': 'No clipboard permission — copy it by hand from the box below.',
  'det.gateUser': '{gate} — chosen by the user',
  'det.gateOpen': '{gate} — open ticket is on this gate',
  'det.trustNew': 'new {asset} trustline opened',
  'det.trustHad': 'already open',
  'det.authOk': 'no password, wallet signature',
  'det.rate': '1 USDC = {rate} TRY',
  'det.ref': 'reference {ref}',
  'det.order': 'order {id}…',
  'det.bank': 'mock anchor: simulate-bank-transfer',
  'det.received': '{amount} {asset}',
  'det.fallback': '{amount} {asset} · fallback',
  'det.skipped': 'skipped in fallback mode',
  'det.locked': '{n} passes · gate {gate}',
  'det.signed': 'operator signed for {n} passes',
  'det.book': '{n} receipts signed',
  'audit.match': 'Declaration matches the chain — no missing revenue.',
  'audit.mismatch': 'MISMATCH: {n} passes never reached the chain.',
  'audit.behindNote': 'Declaration is {n} behind — the gate’s signed counter has not been carried yet. No revenue lost.',
  'audit.note': 'The gate counter is written by gate_report, the receipts by settle. The two numbers come from independent sources; the operator cannot quietly shrink just one.',
  'audit.reading': 'Reading…',
  'audit.back': 'Back to the demo',
  'audit.expert': 'Open the contract on Stellar Expert',
  'carry.errEmpty': 'The text is empty.',
  'carry.errUnreadable': 'Could not read the text — make sure you copied it from the gate page.',
  'carry.errNoReceipts': 'There are no pass records inside.',
  'carry.errNoGateSig': 'A record is incomplete — the gate signature is missing.',
};

const TR: Dict = {
  'nav.demo': 'Demo',
  'nav.how': 'Nasıl çalışır',
  'nav.carry': 'Veriyi taşı',
  'nav.audit': 'Denetim',
  'nav.testnet': 'testnet',
  'profile.live': 'Anchor',
  'profile.local': 'Yedek',
  'profile.tipLive': 'Gerçek anchor (SEP-1/10/38/6). Anchor ödeme yapmıyorsa yedeğe geç.',
  'profile.tipLocal': 'Yedek mod: kendi test varlığımız, ayrı sözleşme. Gerçek anchor’a dönmek için tıkla.',

  'stage.title': 'İnternet yokken de geçiş devam eder.',
  'stage.sub': 'TL yükle, zincirde kilitle, çevrimdışı geç.',
  'stage.more': 'Nasıl çalışır →',
  'stage.foot': 'Stellar Testnet · gerçek para hareketi yoktur',
  'stage.lastTicket': 'son bilet: kapı {gate}',

  'flow.intro': 'Etkinlik içinde geçerli bakiyeni yükle. İnternet olmadan geç.',
  'flow.connect': 'Cüzdanı bağla',
  'flow.connectNote': 'Freighter, Lobstr, Albedo ve diğerleri — Stellar Wallets Kit.',
  'flow.wristband': 'Cüzdanım yok, etkinlik bilekliği ver',
  'flow.connecting': 'Bağlanıyor…',
  'flow.whichGate': 'Hangi kapıdan gireceksin?',
  'flow.openTickets': '{n} açık bilet',
  'flow.full': 'şu an dolu',
  'flow.gatesLoading': 'Kapılar zincirden okunuyor…',
  'flow.noGates': 'Bu etkinliğe kayıtlı kapı yok.',
  'flow.fare': 'Geçiş ücreti',
  'flow.deposit': 'Yükleme',
  'flow.event': 'Etkinlik',
  'flow.pay': '{amount} öde — {gate}',
  'flow.working': 'Çalışıyor…',
  'flow.passes': 'geçiş',
  'flow.feeLine': '+ {fee} teminat = {total}',
  'flow.feeLabel': 'Teminat',
  'flow.feeBack': '%5 — kapı verisini taşırsan {amount} geri',

  'ticket.passes': 'geçiş hakkı',
  'ticket.code': 'Bilet kodu',
  'ticket.codeNote': 'Her bilete özel. Cüzdan, kapı, tutar ve süre bu özetin içinde.',
  'ticket.owner': 'Sahibi',
  'ticket.deviceKey': 'İmza anahtarın',
  'ticket.deviceNote': 'Kapı her geçişte fişin imzasını bu anahtarla doğruluyor — başkasının anahtarıyla imzalanmış fiş kabul edilmiyor.',
  'ticket.rate': 'Kilitli kur',
  'ticket.paid': 'Ödenen',
  'ticket.bankRef': 'Banka referansı',
  'ticket.copy': 'Kapıya git — bileti kopyala',
  'ticket.copied': 'Kopyalandı ✓',
  'ticket.note': 'Fişler şimdiden imzalandı. Kapıda internet gerekmez. Bu metin hamiline geçerlidir — kopyalayan da kullanabilir, etkinlik bilekliği gibi düşün.',
  'ticket.raw': 'Ham paket ({n} karakter)',
  'ticket.lockTx': 'Kilitleme işlemi ↗',
  'ticket.carryCta': 'Kapıdan geçtin mi? Veriyi taşı, paranı al →',

  'carry.eyebrow': 'Ağa katkı',
  'carry.title': 'Kapı verisini zincire taşı',
  'carry.lead': 'Turnikeden geçtiğinde kapı sana imzalı bir tahsilat belgesi verdi. Sözleşme imzanın gerçekten o turnikeye ait olduğunu doğrular ve karşılığında paranı geri verir.',
  'carry.whyTitle': 'Neden taşıyorsun',
  'carry.change': 'Para üstü',
  'carry.changeBody': 'Kapı daha az tahsil ettiyse fark bakiyende kalır.',
  'carry.rebate': 'Teminat iadesi',
  'carry.rebateBody': 'Taşıdığın her geçiş için %5’lik teminatın %80’i cüzdanına döner.',
  'carry.refundable': 'İade hakkı',
  'carry.refundableBody': 'Açık kalan hak kapandığı için geri çekebileceğin tutar büyür.',
  'carry.feeNote': 'İşlem ücreti Stellar’da kuruşun altında — bu yüzden böyle bir mikro ödül ekonomisi burada mantıklı.',
  'carry.pasteTitle': 'Veriyi yapıştır',
  'carry.placeholder': 'Kapı sayfasında kopyaladığın metni buraya yapıştır…',
  'carry.wallet': 'Cüzdan',
  'carry.colGate': 'Kapı',
  'carry.colReceipt': 'Fiş',
  'carry.colCharged': 'Tahsil edilen',
  'carry.colBack': 'Sana dönen',
  'carry.totalBack': 'Toplam iade',
  'carry.alsoReport': 'kapı beyanı da taşınacak (sayaç {n})',
  'carry.submit': 'Zincire yaz ve paramı al',
  'carry.submitting': 'Zincire yazılıyor…',
  'carry.connectFirst': 'Önce cüzdanını bağla.',
  'carry.doneTitle': 'Oldu',
  'carry.donePasses': 'Zincire yazılan geçiş',
  'carry.doneRebate': 'Cüzdanına dönen teminat',
  'carry.doneRefundable': 'Geri çekebileceğin tutar',
  'carry.doneNote': 'Kapı verisi artık zincirde. Operatörün senkronizasyon yapmasına gerek kalmadı — sen yaptın, karşılığını da aldın.',

  'audit.eyebrow': 'Etkinlik {event}',
  'audit.title': 'Denetim',
  'audit.lead': 'Kapının kendi beyanı ile zincirdeki kayıt yan yana.',
  'audit.gates': 'Kapılar',
  'audit.loading': 'Zincirden okunuyor…',
  'audit.none': 'Kayıtlı kapı yok.',
  'audit.colGate': 'Kapı',
  'audit.colDeclared': 'Beyan',
  'audit.colChain': 'Zincirde',
  'audit.colDiff': 'Fark',
  'audit.colLoad': 'Yük',
  'audit.missing': '{n} eksik',
  'audit.behind': 'beyan {n} geride',
  'audit.total': 'Toplam',
  'audit.totalDeclared': 'Beyan edilen geçiş',
  'audit.totalChain': 'Zincirdeki fiş',
  'audit.revenue': 'Hasılat',
  'audit.refresh': 'Yenile',
  'flow.waiting': 'Bekleniyor…',
  'flow.savedBand': 'Bu tarayıcıda kayıtlı bir bileklik var:',
  'flow.thisIsMe': 'Bu benim, devam et',
  'flow.notMe': 'Ben başkasıyım',
  'flow.howMany': 'Kaç geçiş alacaksın?',
  'flow.minus': 'Bir azalt',
  'flow.plus': 'Bir artır',
  'flow.loading': 'Yükleniyor…',
  'flow.addAmount': '{amount} ekle',
  'flow.pickGate': 'Kapı seç',
  'flow.openTicket': 'Zincirde açık biletin var.',
  'flow.openTicketBody': 'Ek yükleme aynı kapıya ve aynı kilitli kura gider: {gate}, 1 USDC = {rate} ₺. İmzalanan {granted} geçişin {used} tanesi zincire düştü.',
  'flow.closeTicket': 'Bileti kapat, kalan bakiyeyi cüzdana geri al',
  'steps.gate': 'Kapı seçildi',
  'steps.trustline': '{asset} güven hattı',
  'steps.auth': 'Cüzdan doğrulandı',
  'steps.quote': 'Kur kilitlendi',
  'steps.deposit': 'Ödeme talimatı alındı',
  'steps.bank': 'Banka transferi alındı',
  'steps.settled': '{asset} hesabınıza geçti',
  'steps.lock': 'Bakiye zincire kilitlendi',
  'steps.entitlement': 'Bilet imzalandı',
  'steps.book': 'Geçiş fişleri hazırlandı',
  'steps.entitlementNote': 'zincirden doğrulandı',
  'ticket.clipboardFail': 'Pano izni yok — aşağıdaki kutudan elle kopyalayın.',
  'det.gateUser': '{gate} — kullanıcı seçti',
  'det.gateOpen': '{gate} — açık bilet bu kapıda',
  'det.trustNew': 'yeni {asset} güven hattı açıldı',
  'det.trustHad': 'zaten açıktı',
  'det.authOk': 'şifre yok, cüzdan imzası',
  'det.rate': '1 USDC = {rate} TRY',
  'det.ref': 'referans {ref}',
  'det.order': 'emir {id}…',
  'det.bank': 'mock anchor: simulate-bank-transfer',
  'det.received': '{amount} {asset}',
  'det.fallback': '{amount} {asset} · yedek anchor',
  'det.skipped': 'yedek modda atlandı',
  'det.locked': '{n} geçiş · kapı {gate}',
  'det.signed': 'operatör {n} geçiş için imzaladı',
  'det.book': '{n} fiş imzalandı',
  'audit.match': 'Beyan ile zincir tutuyor — eksik hasılat yok.',
  'audit.mismatch': 'FARK VAR: {n} geçiş zincire düşmemiş.',
  'audit.behindNote': 'Beyan {n} geride — kapının imzalı sayacı henüz taşınmamış. Hasılat kaybı değil.',
  'audit.note': 'Kapı sayacı gate_report ile, fişler settle ile zincire yazılır. İki sayı bağımsız kaynaklardan gelir; operatör yalnızca birini eksiltemez.',
  'audit.reading': 'Okunuyor…',
  'audit.back': 'Demoya dön',
  'audit.expert': 'Sözleşmeyi Stellar Expert’te aç',
  'carry.errEmpty': 'Metin boş.',
  'carry.errUnreadable': 'Metin okunamadı — kapı sayfasından kopyaladığından emin ol.',
  'carry.errNoReceipts': 'İçinde geçiş kaydı yok.',
  'carry.errNoGateSig': 'Kayıt eksik — kapı imzası yok.',
};

const DICTS: Record<Lang, Dict> = { en: EN, tr: TR };

/**
 * Ceviri. Eksik anahtar sessizce kaybolmasin diye anahtarin kendisini
 * donduruyoruz — ekranda hemen goze batar.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const text = DICTS[current][key] ?? DICTS.en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => String(vars[name] ?? m));
}
