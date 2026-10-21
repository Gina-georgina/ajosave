import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE_SECONDS,
  buildLocaleCookie,
  clearRefreshTokenCookie,
  isSecureContext,
  refreshTokenCookieOptions,
  setRefreshTokenCookie,
} from "../cookies";

function fakeResponse() {
  return { cookies: { set: jest.fn() }, headers: { set: jest.fn() } } as never as Parameters<
    typeof setRefreshTokenCookie
  >[0] & { cookies: { set: jest.Mock }; headers: { set: jest.Mock } };
}

describe("isSecureContext", () => {
  it("is secure only in production", () => {
    expect(isSecureContext("production")).toBe(true);
    expect(isSecureContext("development")).toBe(false);
    expect(isSecureContext("test")).toBe(false);
    expect(isSecureContext(undefined)).toBe(false);
  });
});

describe("refreshTokenCookieOptions", () => {
  const original = process.env.NODE_ENV;
  const setEnv = (v: string) => Object.defineProperty(process.env, "NODE_ENV", { value: v, configurable: true });
  afterEach(() => setEnv(original as string));

  it("is HttpOnly, SameSite=Lax, path=/ with a 7 day lifetime by default", () => {
    expect(refreshTokenCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
    });
    expect(REFRESH_TOKEN_MAX_AGE_SECONDS).toBe(604_800);
  });

  it("sets Secure in production and not in development", () => {
    setEnv("production");
    expect(refreshTokenCookieOptions().secure).toBe(true);
    setEnv("development");
    expect(refreshTokenCookieOptions().secure).toBe(false);
  });
});

describe("setRefreshTokenCookie / clearRefreshTokenCookie", () => {
  it("sets the token with secure attributes and marks the response no-store", () => {
    const res = fakeResponse();
    setRefreshTokenCookie(res, "tok");
    expect(res.cookies.set).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      "tok",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS }),
    );
    expect(res.headers.set).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("clears the cookie with an empty value, maxAge 0 and the same attributes", () => {
    const res = fakeResponse();
    clearRefreshTokenCookie(res);
    expect(res.cookies.set).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      "",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 }),
    );
    expect(res.headers.set).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
});

describe("buildLocaleCookie", () => {
  it("adds SameSite=Lax and a one year lifetime", () => {
    const c = buildLocaleCookie("yo", false);
    expect(c).toContain("locale=yo");
    expect(c).toContain("path=/");
    expect(c).toContain(`max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`);
    expect(c).toContain("SameSite=Lax");
    expect(c).not.toContain("Secure");
  });

  it("adds Secure over https", () => {
    expect(buildLocaleCookie("en", true)).toContain("Secure");
  });

  it("encodes values so they cannot inject cookie attributes", () => {
    const c = buildLocaleCookie("en; Domain=evil.com", false);
    expect(c).not.toContain("Domain=evil.com");
    expect(c).toContain(encodeURIComponent("en; Domain=evil.com"));
  });
});
