import { Router, type RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";

export const authRoutes = Router();

authRoutes.get("/github", (_req, res) => {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID!);
  url.searchParams.set("scope", "repo read:user");
  url.searchParams.set(
    "redirect_uri",
    `${process.env.BACKEND_ORIGIN}/auth/github/callback`,
  );
  res.redirect(url.toString());
});

authRoutes.get("/github/callback", async (req, res, next) => {
  try {
    const code = String(req.query.code ?? "");
    if (!code) return res.status(400).send("missing code");

    const tokRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${process.env.BACKEND_ORIGIN}/auth/github/callback`,
      }),
    }).then((r) => r.json() as any);

    if (!tokRes.access_token) {
      return res
        .status(401)
        .send(
          `GitHub OAuth exchange failed: ${JSON.stringify(tokRes).slice(0, 400)}`,
        );
    }

    const me = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokRes.access_token}`,
        "User-Agent": "reflex-md",
        Accept: "application/vnd.github+json",
      },
    }).then((r) => r.json() as any);

    const user = await prisma.user.upsert({
      where: { githubLogin: me.login },
      update: { accessToken: tokRes.access_token },
      create: { githubLogin: me.login, accessToken: tokRes.access_token },
    });

    const token = jwt.sign({ uid: user.id }, process.env.JWT_SECRET!, {
      expiresIn: "7d",
    });
    res.cookie("session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect(`${process.env.FRONTEND_ORIGIN}/repos`);
  } catch (e) {
    next(e);
  }
});

authRoutes.post("/logout", (_req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

export const requireUser: RequestHandler = async (req: any, res, next) => {
  try {
    const token = req.cookies?.session;
    if (!token) return res.status(401).json({ error: "unauthenticated" });
    const { uid } = jwt.verify(token, process.env.JWT_SECRET!) as {
      uid: string;
    };
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) return res.status(401).json({ error: "user not found" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "invalid session" });
  }
};
