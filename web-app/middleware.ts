import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  hasRequiredRole,
  isApiPath,
  isRole,
  requiredRoleForPath,
} from "@/lib/rbac";

function jsonError(status: 401 | 403, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function redirectTo(req: NextRequest, pathname: string) {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requiredRole = requiredRoleForPath(pathname);

  if (!requiredRole) {
    return NextResponse.next();
  }

  const apiRequest = isApiPath(pathname);
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    return apiRequest
      ? jsonError(401, "Authentication required")
      : redirectTo(req, "/login");
  }

  if (token.isBlocked === true) {
    return apiRequest
      ? jsonError(403, "User is blocked")
      : redirectTo(req, "/unauthorized");
  }

  const role = token.role;
  if (!isRole(role) || !hasRequiredRole(role, requiredRole)) {
    return apiRequest
      ? jsonError(403, "Insufficient role")
      : redirectTo(req, "/unauthorized");
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/analyze/:path*",
    "/history/:path*",
    "/admin/:path*",
    "/moderator/:path*",
    "/api/analyze",
    "/api/admin/:path*",
    "/api/moderator/:path*",
    "/api/history/:path*",
    "/api/flagged-addresses/:path*",
  ],
};
