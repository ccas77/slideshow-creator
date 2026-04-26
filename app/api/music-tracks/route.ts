import { NextRequest, NextResponse } from "next/server";
import { getMusicTracks, getMusicTrack, setMusicTrack, deleteMusicTrack, MusicTrack, redis } from "@/lib/kv";
import { requireSession } from "@/lib/session";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function chunkKey(userId: string, id: string) {
  return `u:${userId}:music-upload:${id}`;
}

export async function GET(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;

  const url = new URL(req.url);
  const trackId = url.searchParams.get("id");
  if (trackId) {
    const track = await getMusicTrack(session.userId, trackId);
    if (!track) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const b64 = track.audioData.includes(",") ? track.audioData.split(",")[1] : track.audioData;
    const buf = Buffer.from(b64, "base64");
    const mime = track.audioData.startsWith("data:") ? track.audioData.split(";")[0].split(":")[1] : "audio/mpeg";
    return new Response(buf, { headers: { "Content-Type": mime, "Content-Length": String(buf.length) } });
  }

  const tracks = await getMusicTracks(session.userId);
  return NextResponse.json({
    tracks: tracks.map((t) => ({ id: t.id, name: t.name })),
  });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;

  const body = await req.json();
  const { action, id, name, audioData, chunked, chunkIndex, totalChunks } = body;

  if (action === "delete" && id) {
    await deleteMusicTrack(session.userId, id);
    return NextResponse.json({ ok: true });
  }

  if (chunked) {
    if (chunkIndex === 0) {
      const trackId = id || uid();
      await redis.set(chunkKey(session.userId, trackId), { name, data: audioData, received: 1, total: totalChunks }, { ex: 600 });
      return NextResponse.json({ ok: true, id: trackId });
    } else {
      if (!id) return NextResponse.json({ error: "id required for chunk > 0" }, { status: 400 });
      const partial = await redis.get<{ name: string; data: string; received: number; total: number }>(chunkKey(session.userId, id));
      if (!partial) return NextResponse.json({ error: "upload session expired" }, { status: 400 });

      const updated = {
        ...partial,
        data: partial.data + audioData,
        received: partial.received + 1,
      };

      if (updated.received >= updated.total) {
        const track: MusicTrack = { id, name: updated.name, audioData: updated.data };
        await setMusicTrack(session.userId, track);
        await redis.del(chunkKey(session.userId, id));
        return NextResponse.json({ ok: true, id, complete: true });
      } else {
        await redis.set(chunkKey(session.userId, id), updated, { ex: 600 });
        return NextResponse.json({ ok: true, id, received: updated.received });
      }
    }
  }

  if (!name || !audioData) {
    return NextResponse.json({ error: "name and audioData required" }, { status: 400 });
  }

  const track: MusicTrack = { id: id || uid(), name, audioData };
  await setMusicTrack(session.userId, track);
  return NextResponse.json({ ok: true, id: track.id });
}
