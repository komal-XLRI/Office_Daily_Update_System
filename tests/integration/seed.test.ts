import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { updateOffice } from "@/lib/services/offices";
import { Office, User } from "@/models";

import {
  ensureIndexes,
  loadStaffFile,
  parseStaffData,
  SEED_OFFICES,
  seedAdmin,
  seedOffices,
  seedStaff,
} from "../../scripts/seed-data/seed-database";
import { createOffice, createUser, registerTestDatabase } from "../setup/db";

registerTestDatabase();

const EXAMPLE_STAFF_FILE = fileURLToPath(
  new URL("../../scripts/seed-data/staff.example.json", import.meta.url),
);

describe("seed offices (spec §35)", () => {
  it("creates the seven offices in order and is idempotent", async () => {
    const first = await seedOffices();
    expect(first.every((office) => office.created)).toBe(true);

    const second = await seedOffices();
    expect(second.some((office) => office.created)).toBe(false);

    const offices = await Office.find().sort({ _id: 1 }).lean();
    expect(offices.map((office) => [office.name, office.code, office.isActive])).toEqual(
      SEED_OFFICES.map((office) => [office.name, office.code, true]),
    );
    expect(SEED_OFFICES.map((office) => office.code)).toEqual([
      "DIRECTOR",
      "DEAN-ADMIN",
      "DEAN-ACA",
      "ADSA",
      "HR",
      "OTHER",
      "XLEAD",
    ]);
  });

  it("never overwrites later admin edits", async () => {
    await seedOffices();
    await Office.updateOne({ code: "HR" }, { $set: { name: "Human Resources", isActive: false } });
    const edited = await Office.findOne({ code: "HR" }).lean();

    await seedOffices();
    const after = await Office.findOne({ code: "HR" }).lean();
    expect(after?.name).toBe("Human Resources");
    expect(after?.isActive).toBe(false);
    expect(after?.updatedAt.getTime()).toBe(edited?.updatedAt.getTime());
    expect(await Office.countDocuments()).toBe(SEED_OFFICES.length);
  });

  it("does not duplicate offices after admins rename or deactivate them", async () => {
    await seedOffices();
    const hr = await Office.findOne({ code: "HR" }).lean();
    const admin = { id: "admin", role: "admin" } as unknown as Parameters<typeof updateOffice>[0];
    await updateOffice(admin, String(hr?._id), { name: "People Office", isActive: false });
    await expect(updateOffice(admin, String(hr?._id), { code: "PEOPLE" })).rejects.toBeInstanceOf(ZodError);

    const rerun = await seedOffices();
    expect(rerun.some((office) => office.created)).toBe(false);
    expect(await Office.countDocuments()).toBe(SEED_OFFICES.length);
    expect(await Office.countDocuments({ code: "HR" })).toBe(1);
    expect(await Office.findOne({ code: "HR" }).lean()).toMatchObject({ name: "People Office", isActive: false });
  });

  it("ensures indexes for the four collections repeatedly", async () => {
    const first = await ensureIndexes();
    const second = await ensureIndexes();
    expect(second).toEqual(first);
    expect(first.map((item) => item.collection)).toEqual(["offices", "users", "visitors", "dailyMilestones"]);
    expect(first.find((item) => item.collection === "dailyMilestones")?.indexes).toContain(
      "officeId_1_date_1",
    );
  });
});

describe("seed admin", () => {
  it("creates an active admin without an office and does not duplicate it", async () => {
    const first = await seedAdmin({ email: "  Admin@XLRI.Example.COM ", name: "System Administrator" });
    expect(first).toMatchObject({ email: "admin@xlri.example.com", created: true, warnings: [] });

    const second = await seedAdmin({ email: "admin@xlri.example.com", name: "Another Name" });
    expect(second).toMatchObject({ created: false, warnings: [] });

    const admins = await User.find({ email: "admin@xlri.example.com" }).lean();
    expect(admins).toHaveLength(1);
    expect(admins[0]).toMatchObject({
      name: "System Administrator",
      role: "admin",
      officeId: null,
      isActive: true,
    });

    const raw = await User.collection.findOne({ email: "admin@xlri.example.com" });
    expect(Object.keys(raw ?? {}).filter((key) => /pass|otp/i.test(key))).toEqual([]);
  });

  it("never demotes, promotes or reactivates an existing account", async () => {
    const office = await createOffice();
    await createUser({ email: "staff@example.com", role: "user", officeId: office });
    const promoted = await seedAdmin({ email: "staff@example.com", name: "System Administrator" });
    expect(promoted.created).toBe(false);
    expect(promoted.warnings.join(" ")).toContain('role "user"');
    expect(await User.findOne({ email: "staff@example.com" }).lean()).toMatchObject({ role: "user" });

    await createUser({ email: "former.admin@example.com", role: "admin", officeId: null, isActive: false });
    const inactive = await seedAdmin({ email: "former.admin@example.com", name: "System Administrator" });
    expect(inactive.warnings.join(" ")).toContain("inactive");
    expect(await User.findOne({ email: "former.admin@example.com" }).lean()).toMatchObject({
      isActive: false,
    });
  });

  it("rejects an invalid email", async () => {
    await expect(seedAdmin({ email: "not-an-email", name: "Admin" })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("seed staff", () => {
  it("ships an example file with the spec §4 people, all inactive with placeholder emails", () => {
    const staff = loadStaffFile(EXAMPLE_STAFF_FILE);
    expect(staff).not.toBeNull();
    const byOffice = (code: string) =>
      staff!.filter((member) => member.officeCode === code).map((m) => m.name);
    expect(byOffice("DIRECTOR")).toEqual(["Director", "Ayushi"]);
    expect(byOffice("DEAN-ADMIN")).toEqual(["Alwyn", "Dayal", "Divya", "Ashwani"]);
    expect(byOffice("DEAN-ACA")).toEqual(["Munish", "Rahul", "Ambika", "Abhijeet"]);
    expect(byOffice("ADSA")).toEqual(["Shubham", "Akanksha", "Jyoti"]);
    expect(staff!.find((member) => member.name === "Ayushi")?.designation).toBe("Assistant");
    expect(staff!.every((member) => !member.isActive && member.email.endsWith("@example.invalid"))).toBe(
      true,
    );
  });

  it("creates normal users in their offices and is idempotent", async () => {
    await seedOffices();
    const staff = loadStaffFile(EXAMPLE_STAFF_FILE)!;

    const first = await seedStaff(staff);
    expect(first.results.every((member) => member.created)).toBe(true);
    const second = await seedStaff(staff);
    expect(second.results.some((member) => member.created)).toBe(false);

    const director = await Office.findOne({ code: "DIRECTOR" }).lean();
    const ayushi = await User.findOne({ email: "ayushi@example.invalid" }).lean();
    expect(ayushi).toMatchObject({ role: "user", designation: "Assistant", isActive: false });
    expect(String(ayushi?.officeId)).toBe(String(director?._id));
    expect(await User.countDocuments({ role: "user" })).toBe(staff.length);
  });

  it("leaves existing accounts unchanged", async () => {
    await seedOffices();
    await seedAdmin({ email: "jyoti@example.invalid", name: "Jyoti Admin" });
    const summary = await seedStaff(
      parseStaffData({
        users: [{ name: "Jyoti", email: "JYOTI@example.invalid", officeCode: "adsa", isActive: true }],
      }),
    );
    expect(summary.results[0]).toMatchObject({ created: false, officeCode: "ADSA" });
    expect(await User.findOne({ email: "jyoti@example.invalid" }).lean()).toMatchObject({
      role: "admin",
      name: "Jyoti Admin",
      officeId: null,
    });
  });

  it("creates nothing when an office code is unknown", async () => {
    await seedOffices();
    const staff = parseStaffData({
      users: [
        { name: "Valid", email: "valid@example.invalid", officeCode: "HR" },
        { name: "Unknown", email: "unknown@example.invalid", officeCode: "FINANCE" },
      ],
    });
    await expect(seedStaff(staff)).rejects.toThrow("FINANCE");
    expect(await User.countDocuments()).toBe(0);
  });

  it("defaults staff to inactive and rejects passwords, roles and duplicate emails", () => {
    expect(
      parseStaffData({
        users: [{ name: "Rahul", email: "rahul@example.invalid", officeCode: "DEAN-ACA" }],
      })[0],
    ).toMatchObject({ isActive: false, designation: "" });

    const entry = { name: "Rahul", email: "rahul@example.invalid", officeCode: "DEAN-ACA" };
    expect(() => parseStaffData({ users: [{ ...entry, password: "secret" }] })).toThrow(/password/);
    expect(() => parseStaffData({ users: [{ ...entry, role: "admin" }] })).toThrow(/role/);
    expect(() => parseStaffData({ users: [entry, { ...entry, email: "RAHUL@example.invalid" }] })).toThrow(
      /Duplicate email/,
    );
    expect(() => parseStaffData([entry])).toThrow();
  });

  it("returns null when the optional staff file does not exist", () => {
    expect(loadStaffFile(fileURLToPath(new URL("./does-not-exist.json", import.meta.url)))).toBeNull();
  });
});
