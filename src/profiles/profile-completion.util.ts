export interface ProfileCompletionResult {
  percentage: number;
  missingFields: string[];
  totalExpected: number;
  filledCount: number;
  isCompleteEnoughForPublic: boolean;
}

/**
 * Calculates profile completion percentage and missing fields based on role and database schema.
 *
 * Rules:
 * - CLIENT & ADMIN (5 standard profile fields):
 *   1. Full Name (user.name)
 *   2. Professional Title / Headline (user.headline)
 *   3. Bio / About (user.bio)
 *   4. Location: City or Country (user.city || user.country)
 *   5. Profile Picture (user.avatarUrl)
 *   Each field counts for 20% (0%, 20%, 40%, 60%, 80%, 100%).
 *
 * - SPECIALIST / FREELANCER (8 role-specific fields):
 *   1. Full Name (user.name)
 *   2. Professional Title / Headline (user.headline)
 *   3. Bio / About (user.bio)
 *   4. Location: City or Country (user.city || user.country)
 *   5. Profile Picture (user.avatarUrl)
 *   6. Verified Skills (user.skills array with length > 0)
 *   7. Hourly Rate (user.hourlyRate > 0)
 *   8. Portfolio (at least 1 portfolioItem of kind 'portfolio', 'services', or 'project')
 *   Percentages: 0/8=0%, 1/8=13%, 2/8=25%, 3/8=38%, 4/8=50%, 5/8=63%, 6/8=75%, 7/8=88%, 8/8=100%.
 *
 * Public visibility rule:
 * - A freelancer must have completion STRICTLY GREATER than 50% (percentage > 50).
 * - A profile at exactly 50% must remain hidden.
 */
export function calculateProfileCompletion(user: {
  role?: string | null;
  name?: string | null;
  fullName?: string | null;
  headline?: string | null;
  bio?: string | null;
  city?: string | null;
  country?: string | null;
  avatarUrl?: string | null;
  photo?: string | null;
  hourlyRate?: any;
  skills?: string[] | null;
  portfolioItems?: any[] | null;
}): ProfileCompletionResult {
  if (!user) {
    return {
      percentage: 0,
      missingFields: [],
      totalExpected: 0,
      filledCount: 0,
      isCompleteEnoughForPublic: false,
    };
  }

  const role = String(user.role || 'SPECIALIST').toUpperCase();
  const name = String(user.name || user.fullName || '').trim();
  const headline = String(user.headline || '').trim();
  const bio = String(user.bio || '').trim();
  const city = String(user.city || '').trim();
  const country = String(user.country || '').trim();
  const location = city || country;
  const avatar = String(user.avatarUrl || user.photo || '').trim();

  const missing: string[] = [];
  let totalExpected = 0;
  let filledCount = 0;

  // 1. Name
  totalExpected++;
  if (name.length > 0) filledCount++;
  else missing.push('Full Name');

  // 2. Headline
  totalExpected++;
  if (headline.length > 0) filledCount++;
  else missing.push('Professional Headline');

  // 3. Bio
  totalExpected++;
  if (bio.length > 0) filledCount++;
  else missing.push('Bio');

  // 4. Location
  totalExpected++;
  if (location.length > 0) filledCount++;
  else missing.push('Location (City/Country)');

  // 5. Avatar
  totalExpected++;
  if (avatar.length > 0) filledCount++;
  else missing.push('Profile Picture');

  // Role-specific for SPECIALIST / Freelancer
  if (role === 'SPECIALIST') {
    // 6. Skills
    totalExpected++;
    const hasSkills =
      Array.isArray(user.skills) &&
      user.skills.filter((s) => typeof s === 'string' && s.trim().length > 0)
        .length > 0;
    if (hasSkills) filledCount++;
    else missing.push('Skills');

    // 7. Hourly Rate
    totalExpected++;
    const rateNum =
      user.hourlyRate != null ? Number(user.hourlyRate) : 0;
    if (!isNaN(rateNum) && rateNum > 0) filledCount++;
    else missing.push('Hourly Rate');

    // 8. Portfolio Items
    totalExpected++;
    const hasPortfolio =
      Array.isArray(user.portfolioItems) &&
      user.portfolioItems.some((i) => {
        const k = String(i.kind || 'portfolio').toLowerCase();
        return (
          k === 'portfolio' ||
          k === 'services' ||
          k === 'project' ||
          k === 'experience' ||
          k === 'education'
        );
      });
    if (hasPortfolio) filledCount++;
    else missing.push('Portfolio');
  }

  const percentage =
    totalExpected > 0 ? Math.round((filledCount / totalExpected) * 100) : 0;

  // Only freelancers with completion STRICTLY GREATER than 50% are visible publicly
  const isCompleteEnoughForPublic = role !== 'SPECIALIST' || percentage > 50;

  return {
    percentage,
    missingFields: missing,
    totalExpected,
    filledCount,
    isCompleteEnoughForPublic,
  };
}
