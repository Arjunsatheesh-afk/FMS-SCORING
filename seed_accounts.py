"""Create demo accounts for the PhysioTracking prototype.

Every account's password is its phone number + ".physio" (prototype shortcut,
see auth_store.default_password_for and the README known-limitations section).

    python seed_accounts.py
"""

from __future__ import annotations

import auth_store

DOCTORS = [
    {
        "email": "priya.sharma@physio.example",
        "display_name": "Dr. Priya Sharma",
        "phone_number": "9876543210",
    },
]

PATIENTS = [
    {
        "email": "ramesh.kumar@example.com",
        "display_name": "Ramesh Kumar",
        "phone_number": "9123456780",
    },
    {
        "email": "anita.rao@example.com",
        "display_name": "Anita Rao",
        "phone_number": "9988776655",
    },
]


def main() -> None:
    auth_store.init_db()

    doctor_ids: list[int] = []
    for spec in DOCTORS:
        try:
            doctor = auth_store.create_user(role="doctor", **spec)
            doctor_ids.append(doctor["id"])
            print(f"created doctor  {doctor['email']}")
        except auth_store.AuthError as exc:
            print(f"skipped doctor  {spec['email']}: {exc}")

    for spec in PATIENTS:
        try:
            patient = auth_store.create_user(
                role="patient",
                created_by=doctor_ids[0] if doctor_ids else None,
                **spec,
            )
            print(f"created patient {patient['email']}")
        except auth_store.AuthError as exc:
            print(f"skipped patient {spec['email']}: {exc}")

    print("\nSign in with:")
    for spec in DOCTORS + PATIENTS:
        print(f"  {spec['email']:36} {auth_store.default_password_for(spec['phone_number'])}")


if __name__ == "__main__":
    main()
