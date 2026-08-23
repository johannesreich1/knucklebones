const jsonBody = async response => {
  try { return await response.json(); } catch { return null; }
};

/**
 * Best-effort cleanup for dedicated live-test accounts. It uses only each
 * account's own authenticated privileges: delete its queue row, discover its
 * participant-visible active matches, and resign those matches through the
 * same public function a real client uses. No service-role credential belongs
 * in a live probe.
 */
export async function cleanupLivePvpState({ supabaseUrl, publishableKey, participants }) {
  const errors = [];
  const uniqueParticipants = [...new Map(
    participants.filter(participant => participant?.id && participant?.jwt)
      .map(participant => [participant.id, participant]),
  ).values()];
  if (uniqueParticipants.length === 0) return errors;

  const request = async (pathname, participant, init = {}) => {
    const response = await fetch(new URL(pathname, `${supabaseUrl}/`), {
      ...init,
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${participant.jwt}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    return { status: response.status, body: await jsonBody(response) };
  };

  const clearQueue = async participant => {
    const path = `/rest/v1/matchmaking_queue?player_id=eq.${encodeURIComponent(participant.id)}`;
    try {
      const result = await request(path, participant, { method: 'DELETE' });
      if (result.status < 200 || result.status >= 300) {
        errors.push(`queue cleanup failed for ${participant.id}: HTTP ${result.status}`);
      }
    } catch (error) {
      errors.push(`queue cleanup failed for ${participant.id}: ${String(error)}`);
    }
  };

  const activeMatches = async () => {
    const matches = new Map();
    await Promise.all(uniqueParticipants.map(async participant => {
      const filter = encodeURIComponent(`(p1.eq.${participant.id},p2.eq.${participant.id})`);
      const path = `/rest/v1/matches?status=eq.active&or=${filter}&select=id,p1,p2,status`;
      try {
        const result = await request(path, participant);
        if (result.status < 200 || result.status >= 300 || !Array.isArray(result.body)) {
          errors.push(`active-match cleanup lookup failed for ${participant.id}: HTTP ${result.status}`);
          return;
        }
        for (const match of result.body) matches.set(match.id, match);
      } catch (error) {
        errors.push(`active-match cleanup lookup failed for ${participant.id}: ${String(error)}`);
      }
    }));
    return matches;
  };

  const queuedPlayers = async () => {
    const queued = new Set();
    await Promise.all(uniqueParticipants.map(async participant => {
      const path = `/rest/v1/matchmaking_queue?player_id=eq.${encodeURIComponent(participant.id)}&select=player_id`;
      try {
        const result = await request(path, participant);
        if (result.status < 200 || result.status >= 300 || !Array.isArray(result.body)) {
          errors.push(`queue cleanup verification failed for ${participant.id}: HTTP ${result.status}`);
          return;
        }
        if (result.body.length) queued.add(participant.id);
      } catch (error) {
        errors.push(`queue cleanup verification failed for ${participant.id}: ${String(error)}`);
      }
    }));
    return queued;
  };

  const resignMatches = async matches => {
    for (const match of matches.values()) {
      const participant = uniqueParticipants.find(candidate =>
        candidate.id === match.p1 || candidate.id === match.p2);
      if (!participant) {
        errors.push(`active match ${match.id} has no cleanup participant`);
        continue;
      }
      try {
        const result = await request('/functions/v1/pvp-claim', participant, {
          method: 'POST',
          body: JSON.stringify({ match_id: match.id, resign: true }),
        });
        const terminal = result.status >= 200 && result.status < 300
          && result.body?.match?.id === match.id
          && ['done', 'forfeit'].includes(result.body.match.status);
        // A peer cleanup can finish the same match between lookup and claim.
        if (!terminal && !(result.status === 409 && result.body?.error === 'match-over')) {
          errors.push(`active-match cleanup failed for ${match.id}: HTTP ${result.status}`);
        }
      } catch (error) {
        errors.push(`active-match cleanup failed for ${match.id}: ${String(error)}`);
      }
    }
  };

  /* Closing a browser aborts its fetch locally, but an Edge Function that
     already received pvp-join can still commit afterward. Converge a strictly
     bounded three times: clear, terminalize, clear again, pause briefly, then
     verify both participant-visible surfaces. Two consecutive clean
     observations are required before returning. Never turn cleanup into an
     unbounded live-system loop. */
  const delays = [100, 250, 500];
  let remainingMatches = new Map();
  let remainingQueues = new Set();
  let cleanObservations = 0;
  for (const waitMs of delays) {
    await Promise.all(uniqueParticipants.map(clearQueue));
    await resignMatches(await activeMatches());
    await Promise.all(uniqueParticipants.map(clearQueue));
    await new Promise(resolve => setTimeout(resolve, waitMs));
    [remainingMatches, remainingQueues] = await Promise.all([activeMatches(), queuedPlayers()]);
    if (remainingMatches.size === 0 && remainingQueues.size === 0) {
      cleanObservations++;
      if (cleanObservations >= 2) return errors;
    } else {
      cleanObservations = 0;
    }
  }
  if (remainingMatches.size) {
    errors.push(`active matches remained after bounded cleanup: ${[...remainingMatches.keys()].join(', ')}`);
  }
  if (remainingQueues.size) {
    errors.push(`queued players remained after bounded cleanup: ${[...remainingQueues].join(', ')}`);
  }
  if (remainingMatches.size === 0 && remainingQueues.size === 0 && cleanObservations < 2) {
    errors.push('cleanup did not reach two consecutive clean observations within three attempts');
  }
  return errors;
}
