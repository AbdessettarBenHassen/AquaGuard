// Texts the server writes itself: alert timelines, push notifications, SMS and
// the "what AquaGuard learned" findings. The home's language is set by its
// owner in the app (home settings `lang`), so every phone and SMS of the home
// gets the same language.

export type Lang = 'en' | 'fr';

export const langOf = (v: unknown): Lang => (v === 'fr' ? 'fr' : 'en');

type Vars = Record<string, string | number>;
type Dict = Record<string, string>;

const en: Dict = {
  // escalation
  'esc.noContacts': 'No contacts to alert. Add people in the Home tab.',
  'esc.graceOver': 'Nobody at home answered the alarm. Alerting the family.',
  'esc.sent.push': 'App alert sent to {name}.',
  'esc.sent.sms': 'SMS sent to {name}.',
  'esc.again': 'Nobody has answered yet. Alerting everyone again.',
  // device events
  'ev.detected': 'Detected: {reason}',
  'ev.alarm': 'The sensor sounds its alarm at home (buzzer and light).',
  'ev.valveAuto': 'Water turned off automatically by the sensor.',
  'ev.valveFailSafe': 'Water turned off for safety: the sensor cannot watch for leaks.',
  'ev.countdown': 'Countdown started: {sec} s for someone at home to press the sensor button.',
  'ev.localAck': 'Someone at home pressed the sensor button: "I have seen it".',
  'ev.minorFault': 'The floor sensor still watches for leaks: the water stays on and no SMS is sent.',
  'ev.defaultLeak': 'Water detected where it should not be.',
  'ev.defaultFault': 'The sensor reports a problem.',
  'ev.defaultHidden': 'Night pressure test failed: the pressure fell with every tap closed. Hidden leak in the pipes or walls.',
  // people
  'res.ack': '{by} is on it. Alert closed.',
  'res.false': '{by} closed the alert (false alarm).',
  'valve.closedBy': '{by} turned the water off from the app.',
  'valve.openedBy': '{by} turned the water back on.',
  // notifications
  'push.leak.title': '💧 Leak in {zone}!',
  'push.leak.body': '🚰 Water turned off · The alarm is sounding at home · Open AquaGuard',
  'push.leakOpen.body': '⚠️ The water is still on · Open AquaGuard',
  'push.hidden.title': '🧱 Hidden leak in {zone}',
  'push.fault.title': '🔧 Check the {zone} sensor',
  'push.fault.body': 'The leak sensor needs attention · Open AquaGuard',
  'push.offline.title': '📡 {zone} sensor offline',
  'push.offline.body': 'No news from the sensor for 30 s. Check its power and Wi-Fi.',
  'push.online.title': '✅ {zone} sensor back online',
  'push.online.body': 'It is watching for leaks again.',
  'push.esc.title': '🚨 Leak in {zone}: nobody answered',
  'push.esc.body': '❌ No answer{who} · Open AquaGuard',
  'push.esc.who': ' · {name} alerted',
  'sms.leak': 'AquaGuard: water leak in {zone} ({home}). {valve} Nobody at home has answered. Please check now.',
  'sms.valveClosed': 'The water was turned off.',
  'sms.valveOpen': 'The water is STILL ON.',
  'sms.fault': 'AquaGuard: the leak sensor in {zone} ({home}) has a problem and nobody answered. Please check it.',
  // insights
  'in.learning': 'The sensor is still learning the usual humidity of this room ({samples} of {total} readings).',
  'in.usual': 'The usual humidity here is about {hum}%. The water sensor counts as wet above {wet}%.',
  'in.none': 'No alerts in the last {days} days.',
  'in.total': '{total} alert(s) in the last {days} days: {leaks} leak(s), {faults} sensor problem(s).',
  'in.slot': 'Most alerts happen {slot} ({n} of {total}).',
  'in.more': 'More alerts this week ({a}) than the week before ({b}).',
  'in.fewer': 'Fewer alerts this week ({a}) than the week before ({b}).',
  'in.response': 'On average the water was off {sec} s after a leak was confirmed.',
  'in.local': 'Someone at home answered {pct}% of the alerts; the family was needed for {esc} of them.',
  'in.growth': 'Leaks grew on average {rate}% per minute on the sensor before the water was turned off.',
  'in.sug.false': '{pct}% of leak alerts were false alarms. Check where the sensor sits (splashes, mopping) or raise the "wet" level in Settings.',
  'in.sug.fault': 'Several sensor problems: check the cable and clean the sensor contacts.',
  'in.sug.esc': 'Several alerts needed the family: show everyone at home the sensor button, one press says "I have seen it".',
  'in.sug.night': 'Leaks at night: they can run for hours unseen. Keep automatic shut-off on for this zone.',
  'slot.night': 'at night (22:00-06:00)',
  'slot.morning': 'in the morning',
  'slot.afternoon': 'in the afternoon',
  'slot.evening': 'in the evening',
};

const fr: Dict = {
  'esc.noContacts': 'Aucun contact à alerter. Ajoutez des personnes dans l’onglet Maison.',
  'esc.graceOver': 'Personne à la maison n’a répondu à l’alarme. La famille est alertée.',
  'esc.sent.push': 'Alerte app envoyée à {name}.',
  'esc.sent.sms': 'SMS envoyé à {name}.',
  'esc.again': 'Toujours pas de réponse. Tout le monde est alerté à nouveau.',
  'ev.detected': 'Détecté : {reason}',
  'ev.alarm': 'Le capteur sonne l’alarme à la maison (buzzer et lumière).',
  'ev.valveAuto': 'Eau coupée automatiquement par le capteur.',
  'ev.valveFailSafe': 'Eau coupée par sécurité : le capteur ne peut plus surveiller les fuites.',
  'ev.countdown': 'Compte à rebours : {sec} s pour qu’une personne à la maison appuie sur le bouton du capteur.',
  'ev.localAck': 'Quelqu’un à la maison a appuyé sur le bouton du capteur : « J’ai vu ».',
  'ev.minorFault': 'Le capteur au sol surveille toujours les fuites : l’eau reste ouverte et aucun SMS n’est envoyé.',
  'ev.defaultLeak': 'De l’eau détectée là où il ne devrait pas y en avoir.',
  'ev.defaultFault': 'Le capteur signale un problème.',
  'ev.defaultHidden': 'Test de pression nocturne échoué : la pression a baissé avec tous les robinets fermés. Fuite cachée dans les tuyaux ou les murs.',
  'res.ack': '{by} s’en occupe. Alerte fermée.',
  'res.false': '{by} a fermé l’alerte (fausse alerte).',
  'valve.closedBy': '{by} a coupé l’eau depuis l’app.',
  'valve.openedBy': '{by} a rouvert l’eau.',
  'push.leak.title': '💧 Fuite : {zone} !',
  'push.leak.body': '🚰 Eau coupée · L’alarme sonne à la maison · Ouvrez AquaGuard',
  'push.leakOpen.body': '⚠️ L’eau est toujours ouverte · Ouvrez AquaGuard',
  'push.hidden.title': '🧱 Fuite cachée : {zone}',
  'push.fault.title': '🔧 Vérifiez le capteur : {zone}',
  'push.fault.body': 'Le capteur de fuite a besoin d’attention · Ouvrez AquaGuard',
  'push.offline.title': '📡 Capteur hors ligne : {zone}',
  'push.offline.body': 'Aucune nouvelle du capteur depuis 30 s. Vérifiez son alimentation et le Wi-Fi.',
  'push.online.title': '✅ Capteur de nouveau en ligne : {zone}',
  'push.online.body': 'Il surveille à nouveau les fuites.',
  'push.esc.title': '🚨 Fuite : {zone}, personne n’a répondu',
  'push.esc.body': '❌ Pas de réponse{who} · Ouvrez AquaGuard',
  'push.esc.who': ' · {name} alerté',
  'sms.leak': 'AquaGuard : fuite d’eau, {zone} ({home}). {valve} Personne à la maison n’a répondu. Vérifiez maintenant.',
  'sms.valveClosed': 'L’eau a été coupée.',
  'sms.valveOpen': 'L’eau est TOUJOURS OUVERTE.',
  'sms.fault': 'AquaGuard : le capteur de fuite ({zone}, {home}) a un problème et personne n’a répondu. Vérifiez-le.',
  'in.learning': 'Le capteur apprend encore l’humidité habituelle de la pièce ({samples} sur {total} mesures).',
  'in.usual': 'L’humidité habituelle ici est d’environ {hum} %. Le capteur d’eau est considéré mouillé au-dessus de {wet} %.',
  'in.none': 'Aucune alerte ces {days} derniers jours.',
  'in.total': '{total} alerte(s) ces {days} derniers jours : {leaks} fuite(s), {faults} problème(s) de capteur.',
  'in.slot': 'La plupart des alertes arrivent {slot} ({n} sur {total}).',
  'in.more': 'Plus d’alertes cette semaine ({a}) que la semaine d’avant ({b}).',
  'in.fewer': 'Moins d’alertes cette semaine ({a}) que la semaine d’avant ({b}).',
  'in.response': 'En moyenne, l’eau était coupée {sec} s après la confirmation d’une fuite.',
  'in.local': 'Quelqu’un à la maison a répondu à {pct} % des alertes ; la famille a été nécessaire pour {esc} d’entre elles.',
  'in.growth': 'Les fuites augmentaient en moyenne de {rate} % par minute sur le capteur avant la coupure.',
  'in.sug.false': '{pct} % des alertes de fuite étaient de fausses alertes. Vérifiez l’emplacement du capteur (éclaboussures, serpillière) ou montez le seuil « mouillé » dans Réglages.',
  'in.sug.fault': 'Plusieurs problèmes de capteur : vérifiez le câble et nettoyez les contacts du capteur.',
  'in.sug.esc': 'Plusieurs alertes ont eu besoin de la famille : montrez à tous le bouton du capteur, un appui dit « J’ai vu ».',
  'in.sug.night': 'Des fuites la nuit : elles peuvent couler des heures sans être vues. Gardez la coupure automatique pour cette zone.',
  'slot.night': 'la nuit (22h-6h)',
  'slot.morning': 'le matin',
  'slot.afternoon': 'l’après-midi',
  'slot.evening': 'le soir',
};

const DICTS: Record<Lang, Dict> = { en, fr };

export function tr(lang: Lang, key: string, vars: Vars = {}) {
  const text = DICTS[lang][key] ?? en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
}
