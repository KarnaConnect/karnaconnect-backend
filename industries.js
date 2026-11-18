// ── Industry playbooks for Mash sales outreach ───────────────────────────────
// Each industry gets: who to target, when to call, what hurts, how Mash helps,
// and the OpenStreetMap tags used by the lead finder.
//
// Calling windows are local time for the business, always inside the legal
// telemarketing hours (Mon–Fri 9am–8pm). They aim for the quiet part of each
// industry's day: tradies at smoko/lunch or packing up, salons between
// clients, clinics after the morning rush, hospitality between services.

const INDUSTRIES = {
  trades: {
    label: 'Trades (plumbers, electricians, builders)',
    folder: 'Trades',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    windows: [['12:00', '13:30'], ['15:30', '17:00']],
    whenWhy: 'Lunch or packing up for the day: they are on the tools in the morning.',
    osm: [['craft', 'plumber'], ['craft', 'electrician'], ['craft', 'builder'], ['craft', 'carpenter'], ['craft', 'roofer'], ['craft', 'tiler'], ['craft', 'painter'], ['craft', 'plasterer'], ['craft', 'hvac'], ['craft', 'glaziery'], ['shop', 'trade'], ['office', 'construction_company']],
    playbook: `INDUSTRY: trades (plumbers, electricians, builders, sparkies, chippies, roofers, tilers, painters, aircon).
- Their pain: they're on the tools, up a ladder or under a house all day. The phone rings in their pocket and they can't answer. Voicemail = the customer rings the next tradie on Google. After-hours emergency calls (burst pipe, power out) go nowhere.
- Good questions: "Who answers the phone when you're on a job?" "What happens to a call that comes in while you're up a roof?" "Do you get many after-hours or emergency calls?" "What's a typical job worth to you?"
- Angle: Mash picks up while they're working, gets the customer's name, address, what the job is and how urgent, and texts them a summary so they can call back at smoko. Urgent jobs get flagged. One extra job a month usually covers it.
- Speak their language: casual, straight to the point, no fluff. Respect that they're busy.`
  },
  hair_beauty: {
    label: 'Hair, beauty and nail salons',
    folder: 'Hair & Beauty',
    days: ['Tue', 'Wed', 'Thu'],
    windows: [['09:30', '11:00'], ['14:00', '15:30']],
    whenWhy: 'Mid-week, mid-morning or mid-afternoon, between clients. Many salons are closed or slammed Mondays, Fridays and weekends.',
    osm: [['shop', 'hairdresser'], ['shop', 'beauty'], ['shop', 'massage'], ['shop', 'nails'], ['amenity', 'spa'], ['shop', 'tattoo'], ['shop', 'barber']],
    playbook: `INDUSTRY: hair, beauty, nail and lash salons, barbers, day spas, massage.
- Their pain: stylists have their hands in someone's hair and can't pick up. Missed calls = missed bookings, and clients book wherever answers first. Reception costs money, and after-hours calls (when people actually think about booking) go to voicemail.
- Good questions: "Who grabs the phone when you're all with clients?" "Do people call after hours to book?" "How many calls do you reckon go unanswered on a busy Saturday?"
- Angle: Mash answers every call in a friendly voice, takes the booking request (service, preferred day and time, name and number) and sends it straight through, so the salon confirms when they're free. It can answer the usual questions: prices, opening hours, parking.
- Tone: warm, friendly, upbeat.`
  },
  health_clinics: {
    label: 'Health clinics (physio, dental, chiro, GP, allied health)',
    folder: 'Health Clinics',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    windows: [['10:30', '11:45'], ['14:00', '15:30']],
    whenWhy: 'After the morning rush and before the after-school peak. Ask for the practice manager.',
    osm: [['healthcare', 'physiotherapist'], ['healthcare', 'chiropractor'], ['healthcare', 'podiatrist'], ['healthcare', 'optometrist'], ['healthcare', 'psychotherapist'], ['healthcare', 'dentist'], ['amenity', 'dentist'], ['amenity', 'clinic'], ['amenity', 'doctors'], ['healthcare', 'alternative']],
    playbook: `INDUSTRY: health clinics (physio, chiro, dental, podiatry, optometry, psychology, GP, allied health). Usually you speak to reception first; ask for the practice manager or owner.
- Their pain: reception is juggling patients at the desk and the phone at the same time. Callers on hold hang up and book elsewhere. After-hours and lunch-time calls go to voicemail. New-patient enquiries are the most valuable calls and the ones most often missed.
- Good questions: "What happens to calls when reception is busy with a patient at the desk?" "Do you get many new-patient enquiries after hours?" "Is your reception team stretched?"
- Angle: Mash handles overflow, lunch breaks and after-hours: answers common questions (hours, services, location, whether they bulk bill, if the clinic tells us), takes new-patient and appointment requests with name, number and reason, and flags anything urgent. It never gives medical advice; it takes a message for the clinic.
- Be professional and calm. Never suggest Mash gives clinical advice.`
  },
  automotive: {
    label: 'Automotive (mechanics, tyres, panel beaters, detailing)',
    folder: 'Automotive',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    windows: [['10:00', '11:30'], ['14:00', '15:30']],
    whenWhy: 'After morning drop-offs and before afternoon pick-ups.',
    osm: [['shop', 'car_repair'], ['shop', 'tyres'], ['craft', 'car_repair'], ['shop', 'car_parts'], ['amenity', 'car_wash']],
    playbook: `INDUSTRY: automotive (mechanics, auto electricians, tyre shops, panel beaters, detailers).
- Their pain: mechanics are under cars with greasy hands; the phone rings out. Customers calling for a service booking, a quote or "is my car ready?" don't wait around.
- Good questions: "Who answers the phone when everyone's in the workshop?" "How many calls a day are just 'is my car ready?'" "Do people try to book services after hours?"
- Angle: Mash answers every call, takes service bookings (rego, make and model, what's wrong, preferred day), answers the usual questions, and texts the workshop a summary. Mash can also make outbound "your car's ready" calls. A Perth workshop already uses Mash for that.
- Tone: friendly, practical.`
  },
  real_estate: {
    label: 'Real estate and property management',
    folder: 'Real Estate',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    windows: [['09:30', '11:00'], ['14:00', '16:00']],
    whenWhy: 'Weekday office hours. Avoid Saturdays (home opens).',
    osm: [['office', 'estate_agent'], ['shop', 'estate_agent']],
    playbook: `INDUSTRY: real estate agencies and property managers.
- Their pain: agents are at appraisals and home opens; property managers are flooded with tenant calls (maintenance, rent, "is it still available?"). A missed seller or buyer call can be a lost listing worth thousands.
- Good questions: "What happens to calls when your agents are out at appraisals?" "How much of your PM team's day goes on repeat tenant calls?" "Do you get enquiries on listings after hours?"
- Angle: Mash answers 24/7, qualifies buyer and seller enquiries (property, budget, timeframe), logs maintenance requests with all the details, and sends a summary to the right person. Hot seller leads are flagged straight away.
- Tone: polished, professional.`
  },
  hospitality: {
    label: 'Cafes, restaurants and takeaway',
    folder: 'Hospitality',
    days: ['Tue', 'Wed', 'Thu'],
    windows: [['14:30', '16:30']],
    whenWhy: 'Between lunch and dinner service, mid-week. Never at meal times.',
    osm: [['amenity', 'restaurant'], ['amenity', 'cafe'], ['amenity', 'fast_food']],
    playbook: `INDUSTRY: cafes, restaurants, takeaway.
- Their pain: during service nobody can answer the phone. Booking calls, "are you open?", "do you have gluten-free?" and function enquiries ring out. Missed bookings are empty tables.
- Good questions: "Who answers the phone during a busy service?" "Do you take phone bookings or function enquiries?" "How often does the phone ring out on a Friday night?"
- Angle: Mash answers every call during service and after hours, takes table bookings and function enquiries, and answers the usual questions (hours, menu basics, dietary options, parking). The team gets a summary instead of a ringing phone.
- Tone: friendly and quick. They're busy.`
  },
  home_services: {
    label: 'Home services (cleaning, pest control, landscaping, removals)',
    folder: 'Home Services',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    windows: [['12:00', '13:30'], ['15:30', '17:00']],
    whenWhy: 'Lunch or end of day; owners are usually out on jobs.',
    osm: [['craft', 'gardener'], ['craft', 'cleaning'], ['shop', 'dry_cleaning'], ['craft', 'pest_control'], ['office', 'moving_company'], ['shop', 'garden_centre'], ['craft', 'locksmith'], ['shop', 'locksmith']],
    playbook: `INDUSTRY: home services (cleaners, pest control, gardeners and landscapers, pool services, removalists, locksmiths).
- Their pain: usually an owner-operator out on jobs all day. Quote requests come in by phone and the first business to answer usually wins the job.
- Good questions: "Who handles quote calls while you're out on a job?" "How quickly do you usually get back to a missed call?" "Do you get calls on weekends?"
- Angle: Mash answers straight away, collects the details for a quote (address, job, timing, photos to follow by text), and sends a summary so the owner can quote between jobs. Faster response wins more jobs.
- Tone: friendly, down to earth.`
  },
  professional_services: {
    label: 'Professional services (accountants, lawyers, brokers)',
    folder: 'Professional Services',
    days: ['Tue', 'Wed', 'Thu'],
    windows: [['10:00', '11:30'], ['14:00', '16:00']],
    whenWhy: 'Mid-morning or mid-afternoon, mid-week. Avoid Mondays and end of month.',
    osm: [['office', 'accountant'], ['office', 'lawyer'], ['office', 'financial_advisor'], ['office', 'insurance'], ['office', 'tax_advisor'], ['office', 'financial']],
    playbook: `INDUSTRY: professional services (accountants, bookkeepers, lawyers, mortgage and finance brokers, insurance).
- Their pain: professionals are in client meetings and can't take calls; new-client enquiries go to voicemail and shop around. Admin staff spend time on routine calls.
- Good questions: "What happens to new-client enquiries when you're in meetings?" "Does someone screen your calls at the moment?" "How many calls are routine questions your team keeps answering?"
- Angle: Mash takes every enquiry professionally, captures who they are and what they need, books consultations or call-backs, and sends a clean summary. Routine questions get answered without interrupting anyone.
- Tone: professional and concise. Mash never gives legal or financial advice; it takes messages.`
  },
  fitness: {
    label: 'Gyms, studios and personal trainers',
    folder: 'Fitness',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    windows: [['10:00', '11:30'], ['13:30', '15:30']],
    whenWhy: 'Between the morning and evening class peaks.',
    osm: [['leisure', 'fitness_centre'], ['leisure', 'sports_centre'], ['sport', 'yoga'], ['sport', 'pilates'], ['sport', 'martial_arts']],
    playbook: `INDUSTRY: gyms, yoga and pilates studios, martial arts, personal trainers.
- Their pain: trainers are running classes; enquiry calls about memberships, trials and timetables go unanswered, and that's a lost member.
- Good questions: "Who answers the phone while classes are on?" "Do you get many calls asking about trials or memberships?"
- Angle: Mash answers every enquiry, explains memberships and timetables (from the info the gym gives us), books trial classes and passes hot leads straight to the owner.
- Tone: energetic and friendly.`
  },
  pet_vet: {
    label: 'Vets, groomers and pet services',
    folder: 'Pets & Vets',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    windows: [['10:30', '11:45'], ['14:00', '15:30']],
    whenWhy: 'After morning surgery and before the afternoon rush.',
    osm: [['amenity', 'veterinary'], ['shop', 'pet_grooming'], ['amenity', 'animal_boarding'], ['shop', 'pet']],
    playbook: `INDUSTRY: vets, pet groomers, boarding kennels, dog trainers.
- Their pain: front desk is busy with pets and owners; booking calls ring out. After-hours worried owners call and get voicemail.
- Good questions: "What happens to calls when reception is busy with a patient?" "Do you get many after-hours calls?"
- Angle: Mash answers every call, takes booking requests (pet, owner, what's needed, preferred time), answers common questions, and for anything urgent gives the clinic's emergency instructions (never medical advice) and flags it straight away.
- Tone: warm and caring.`
  }
};

const DEFAULT_PLAYBOOK = `INDUSTRY: general small business.
- Their pain: when the owner or staff are busy, the phone goes to voicemail and callers try the next business.
- Good questions: "Who answers the phone when you're flat out?" "What happens to calls after hours?"
- Angle: Mash answers every call 24/7, takes the details and sends a summary straight away so no enquiry is lost.`;

function getIndustry(key) {
  return INDUSTRIES[key] || null;
}

// Best-match an industry key from free text (CSV imports, contact rows)
function matchIndustry(text) {
  if (!text) return null;
  if (INDUSTRIES[text]) return text;
  const t = String(text).toLowerCase();
  const rules = [
    ['trades', /plumb|electric|sparky|build|carpent|roof|tile|tiling|paint|plaster|aircon|hvac|glaz|concret|construct|fenc|bricklay|gas ?fit|handyman|trade/],
    ['hair_beauty', /hair|beauty|salon|nail|lash|brow|barber|spa|massage|wax|tattoo/],
    ['health_clinics', /physio|chiro|dent|podiat|optom|psycho|clinic|medical|doctor|gp\b|health|osteo|allied/],
    ['automotive', /mechanic|auto|car |tyre|tire|panel|smash|detail|motor/],
    ['real_estate', /real estate|property|estate agent|realty/],
    ['hospitality', /cafe|café|restaurant|takeaway|pizza|bar\b|pub|food|bakery|catering/],
    ['home_services', /clean|pest|garden|landscap|lawn|pool|removal|mover|locksmith|window/],
    ['professional_services', /account|bookkeep|lawyer|legal|solicitor|broker|finance|insurance|tax/],
    ['fitness', /gym|fitness|yoga|pilates|personal train|martial|crossfit|boxing/],
    ['pet_vet', /vet|pet|groom|kennel|dog|cat/]
  ];
  for (const [key, re] of rules) if (re.test(t)) return key;
  return null;
}

function listIndustries() {
  return Object.entries(INDUSTRIES).map(([key, i]) => ({ key, label: i.label, folder: i.folder, days: i.days, windows: i.windows, whenWhy: i.whenWhy }));
}

module.exports = { INDUSTRIES, DEFAULT_PLAYBOOK, getIndustry, matchIndustry, listIndustries };
