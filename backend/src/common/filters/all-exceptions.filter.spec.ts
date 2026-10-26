import { ArgumentsHost, ForbiddenException } from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";

describe("AllExceptionsFilter", () => {
  function buildHost() {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  }

  it("passes through an HttpException's own status and body unchanged", () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = buildHost();

    filter.catch(new ForbiddenException("nope"), host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: "nope" }));
  });

  it("maps an unexpected Error to a generic 500 with no internal detail leaked", () => {
    const filter = new AllExceptionsFilter();
    const { host, status, json } = buildHost();

    filter.catch(new Error("db connection string has a password in it: mongodb://u:p@host"), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("password");
  });

  it("handles a thrown non-Error value without crashing", () => {
    const filter = new AllExceptionsFilter();
    const { host, status } = buildHost();

    expect(() => filter.catch("a string was thrown", host)).not.toThrow();
    expect(status).toHaveBeenCalledWith(500);
  });
});
