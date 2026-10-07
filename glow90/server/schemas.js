'use strict';
// Tüm JSON şemaları: kullanıcı girdisi (onboarding, check-in, ayarlar) ve AI çıktıları.
const S = (max = 200) => ({ type: 'string', maxLength: max });
const strArr = (max = 10, len = 60) => ({ type: 'array', maxItems: max, items: S(len) });
const int = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const num = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const en = (...v) => ({ type: 'string', enum: v });

const GOALS = ['lose_weight', 'reduce_fat', 'build_muscle', 'look_fit', 'fitness', 'sleep', 'energy',
  'skin', 'selfcare', 'nutrition', 'discipline', 'steps', 'lifestyle'];
const SELFCARE = ['skin', 'hair', 'beard', 'dental', 'shower', 'nails', 'style', 'hygiene', 'posture', 'general'];
const time = { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' };

// Onboarding yanıtları: hepsi opsiyonel (kullanıcı atlayabilir); eksikler engine'de varsayılanlanır.
const answers = {
  type: 'object', additionalProperties: false,
  properties: {
    age: int(10, 100), height_cm: int(100, 230), weight_kg: num(30, 300),
    sex: en('female', 'male', 'other', 'skip'), country: S(60),
    occupation: en('student', 'worker', 'mixed', 'other'), busy_hours: int(0, 16),
    goals: { type: 'array', maxItems: 5, items: en(...GOALS) }, free_text: S(500),
    days_per_week: int(1, 7), minutes_per_day: int(10, 120), preferred_time: en('morning', 'evening', 'flexible'),
    has_gym: { type: 'boolean' }, home_equipment: { type: 'array', maxItems: 5, items: en('dumbbell', 'bar', 'bands', 'none') },
    can_walk: { type: 'boolean' }, can_swim: { type: 'boolean' }, has_bike: { type: 'boolean' },
    likes: strArr(8), dislikes: strArr(8), busy_days: { type: 'array', maxItems: 7, items: int(0, 6) },
    weekend_style: en('active', 'relaxed', 'busy'),
    meals_per_day: int(1, 6), breakfast: en('always', 'sometimes', 'never'), eating_out: en('rare', 'weekly', 'often'),
    foods_like: S(200), foods_dislike: S(200), allergies: S(200), diet: en('none', 'vegetarian', 'vegan', 'other'),
    cooking: en('yes', 'limited', 'no'), budget: en('low', 'mid', 'high'), sweets: en('rare', 'weekly', 'daily'),
    night_eating: { type: 'boolean' }, water_l: num(0, 8),
    past_exercise: { type: 'boolean' }, current_exercise: en('none', 'light', 'regular'), injuries: S(300),
    bedtime: time, waketime: time, sleep_hours: num(3, 12), sleep_quality: int(1, 10),
    phone_in_bed: { type: 'boolean' }, caffeine: en('none', 'low', 'high'), morning_energy: int(1, 10), energy_dips: { type: 'boolean' },
    selfcare: { type: 'array', maxItems: 10, items: en(...SELFCARE) },
    discipline: int(1, 10), derail: S(200), stress_behavior: S(200), quick_drop: { type: 'boolean' },
    support: en('solo', 'support'), reminders: { type: 'boolean' }, coach_tone: en('gentle', 'friendly', 'strict'),
    task_style: en('short', 'detailed'),
  },
};

const checkin = {
  type: 'object', additionalProperties: false,
  properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    sleep: num(0, 16), energy: int(1, 10), stress: int(1, 10), hunger: int(1, 10), difficulty: int(1, 10),
    steps: int(0, 100000), weight: num(30, 300), note: S(500),
  },
};

const settings = {
  type: 'object', additionalProperties: false,
  properties: {
    coach_tone: en('gentle', 'friendly', 'strict'), units: en('metric', 'imperial'),
    notifications: {
      type: 'object', additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' }, morning: time, checkin: time, water: { type: 'boolean' },
        workout: { type: 'boolean' }, sleep: { type: 'boolean' },
      },
    },
  },
};

// ---- AI çıktı şemaları (tool input_schema olarak da kullanılır) ----
const ai = {
  ONBOARDING_ANALYSIS: {
    type: 'object', additionalProperties: false,
    required: ['headline', 'primary_goal', 'secondary_goals', 'outcomes', 'focus_notes', 'difficulty_tolerance', 'coach_tone'],
    properties: {
      headline: S(160), primary_goal: en(...GOALS), secondary_goals: { type: 'array', maxItems: 3, items: en(...GOALS) },
      outcomes: { type: 'array', minItems: 2, maxItems: 5, items: S(120) },
      focus_notes: { type: 'array', maxItems: 4, items: S(140) },
      difficulty_tolerance: int(1, 10), coach_tone: en('gentle', 'friendly', 'strict'),
    },
  },
  PLAN_GENERATION: {
    type: 'object', additionalProperties: false, required: ['phases', 'welcome'],
    properties: {
      welcome: S(220),
      phases: {
        type: 'array', minItems: 3, maxItems: 3,
        items: {
          type: 'object', additionalProperties: false, required: ['phase', 'theme', 'focus'],
          properties: { phase: int(1, 3), theme: S(80), focus: S(200) },
        },
      },
      custom_habits: {
        type: 'array', maxItems: 2,
        items: {
          type: 'object', additionalProperties: false, required: ['title', 'category', 'minimum_version'],
          properties: { title: S(80), category: en('movement', 'nutrition', 'sleep', 'selfcare', 'habit'), minimum_version: S(80) },
        },
      },
    },
  },
  DAILY_ADAPTATION: {
    type: 'object', additionalProperties: false, required: ['coach_message'],
    properties: { coach_message: S(220) },
  },
  WEEKLY_REVIEW: {
    type: 'object', additionalProperties: false, required: ['best', 'hardest', 'next_week'],
    properties: { best: S(140), hardest: S(140), next_week: S(160) },
  },
  COACH_CHAT: {
    type: 'object', additionalProperties: false, required: ['reply', 'action'],
    properties: {
      reply: S(600),
      action: en('none', 'minimum_today', 'lighten', 'boost', 'quick_20'),
    },
  },
  FINAL_REPORT: {
    type: 'object', additionalProperties: false,
    required: ['started', 'changed', 'strongest', 'hardest', 'keep', 'next_direction'],
    properties: {
      started: S(200), changed: { type: 'array', maxItems: 4, items: S(140) },
      strongest: S(140), hardest: S(140), keep: { type: 'array', maxItems: 4, items: S(100) }, next_direction: S(240),
    },
  },
};

module.exports = { GOALS, SELFCARE, answers, checkin, settings, ai };
