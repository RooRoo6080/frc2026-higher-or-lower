export interface TBAMedia {
    type: string;
    foreign_key: string;
    direct_url?: string;
    details?: {
        image_partial?: string;
        base64_image?: string;
    };
}

export interface StatboticsTeam {
    team: number;
    name: string;
    epa: {
        total_points: { mean: number };
        norm: number;
    };
}

export interface GameTeam {
    teamNumber: number;
    name: string;
    epa?: number;
    blueBanners?: number;
    imageUrl?: string;
}

// Fisher-Yates array shuffle
export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export async function fetchAllTeams(): Promise<StatboticsTeam[]> {
    const offsets = [0, 1000, 2000, 3000, 4000];
    const promises = offsets.map(offset => 
        fetch(`https://api.statbotics.io/v3/team_years?year=2026&limit=1000&offset=${offset}`)
            .then(res => {
                if (!res.ok) throw new Error("Failed to fetch from Statbotics");
                return res.json();
            })
            .catch(() => []) // fallback for errors to avoid crashing all
    );
    
    const results = await Promise.all(promises);
    return results.flat();
}

export async function fetchTeamImage(teamStr: string | number): Promise<string | null> {
    const res = await fetch(`/api/tba/team/${teamStr}/media/2026`);
    if (!res.ok) {
        if (res.status === 401) throw new Error("Invalid TBA API Key");
        return null;
    }
    const media: TBAMedia[] = await res.json();
    
    // Prioritize direct urls then standard recognizable formats
    let candidateUrl: string | null = null;
    for (const m of media) {
        if (m.direct_url && typeof m.direct_url === 'string') {
            candidateUrl = m.direct_url;
            break;
        }
        if (m.type === 'imgur') {
            candidateUrl = `https://i.imgur.com/${m.foreign_key}.jpeg`;
            break;
        }
        if (m.type === 'instagram-image') {
            candidateUrl = `https://instagram.com/p/${m.foreign_key}/media/?size=l`;
            break;
        }
    }
    
    if (!candidateUrl) return null;
    
    // Convert http to https to avoid mixed content
    if (candidateUrl.startsWith('http://')) {
        candidateUrl = candidateUrl.replace('http://', 'https://');
    }
    
    return candidateUrl;
}

export async function fetchTeamBlueBanners(teamStr: string | number): Promise<number | null> {
    const res = await fetch(`/api/tba/team/${teamStr}/blue-banners`);
    if (!res.ok) {
        if (res.status === 401) throw new Error("Invalid TBA API Key");
        return null;
    }
    const data = await res.json();
    return data.count;
}

export function preloadImage(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}
