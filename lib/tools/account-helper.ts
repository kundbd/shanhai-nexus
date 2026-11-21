export const accountHelperPath = "/tools/account-helper";
export const accountHelperTitle = "本地强密码与注册资料生成器";
export const accountHelperDescription = "本地生成随机密码、英文姓名、成年测试出生日期和用户名。";

export const passwordGroups = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{}:,.?",
} as const;
export type PasswordGroup = keyof typeof passwordGroups;

const firstNames = [
  "Alice", "Amelia", "Anna", "Benjamin", "Charlotte", "Daniel", "David", "Eleanor",
  "Elizabeth", "Emma", "Ethan", "Eva", "Gabriel", "Grace", "Hannah", "Henry",
  "Isabel", "Jack", "James", "Julia", "Leo", "Lily", "Lucas", "Maya",
  "Mia", "Nathan", "Nora", "Oliver", "Olivia", "Oscar", "Samuel", "Sofia",
  "Thomas", "Victoria", "William", "Zoe",
];
const lastNames = [
  "Adams", "Anderson", "Baker", "Bennett", "Brooks", "Brown", "Campbell", "Carter",
  "Clark", "Collins", "Cooper", "Davis", "Edwards", "Ellis", "Evans", "Foster",
  "Gray", "Green", "Hall", "Harris", "Hughes", "Johnson", "Kelly", "Lewis",
  "Martin", "Miller", "Morgan", "Parker", "Reed", "Roberts", "Scott", "Taylor",
  "Thompson", "Walker", "White", "Wilson",
];

function randomIndex(size: number) {
  const limit = 0x100000000 - 0x100000000 % size;
  const sample = new Uint32Array(1);
  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= limit);
  return sample[0] % size;
}

export function generatePassword(length: number, groups: readonly PasswordGroup[]) {
  const sets = [...new Set(groups)].map(group => passwordGroups[group]);
  if (!sets.length || !Number.isInteger(length) || length < 12 || length > 32) return;
  const pool = sets.join("");
  let password: string;
  do {
    password = Array.from({ length }, () => pool[randomIndex(pool.length)]).join("");
  } while (!sets.every(set => [...password].some(character => set.includes(character))));

  // A conservative entropy estimate counts only strings with each group present
  // in a designated position. All valid strings are sampled uniformly.
  const entropy = Math.floor((length - sets.length) * Math.log2(pool.length) +
    sets.reduce((bits, set) => bits + Math.log2(set.length), 0));
  return { password, entropy };
}

const dayMs = 86_400_000;

function birthdayCutoff(today: Date, yearsAgo: number) {
  const year = today.getFullYear() - yearsAgo;
  const month = today.getMonth();
  const day = Math.min(today.getDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return Date.UTC(year, month, day) / dayMs;
}

export function generateTestProfile(today = new Date()) {
  const firstName = firstNames[randomIndex(firstNames.length)];
  const lastName = lastNames[randomIndex(lastNames.length)];
  const firstDay = birthdayCutoff(today, 66) + 1;
  const lastDay = birthdayCutoff(today, 18);
  const date = new Date((firstDay + randomIndex(lastDay - firstDay + 1)) * dayMs);
  const suffix = String(randomIndex(10_000)).padStart(4, "0");
  return {
    firstName,
    lastName,
    birthday: date.toISOString().slice(0, 10),
    username: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${suffix}`,
  };
}
