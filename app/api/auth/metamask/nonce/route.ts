import { NextResponse } from "next/server";
import crypto from "crypto";

export async function GET() {
  const nonce = crypto.randomBytes(16).toString("hex");

  const res = NextResponse.json({ nonce });
  // HttpOnly cookie, чтобы JS не мог подменить nonce
  res.cookies.set("mm_nonce", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10, // 10 минут
  });

  return res;
}
