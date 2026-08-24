import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { AuthSession, CurrentUser } from '../../../shared/types';
import { Driver, Student } from '../models/index.js';
import { fail, issueToken, requireAuth } from '../middleware/auth.js';
import { toDriver, toStudent } from '../serialise.js';

export const authRouter = Router();

const SCHOOL_DOMAIN = '@livingstone.edu';
const MIN_PASSWORD = 8;

interface SignUpBody {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  homeStopId?: string;
}

/** Field-level validation, returned in ApiError.fields for the form. */
function validateSignUp(body: SignUpBody): Record<string, string> {
  const fields: Record<string, string> = {};

  if (!body.firstName?.trim()) fields.firstName = 'Required.';
  if (!body.lastName?.trim()) fields.lastName = 'Required.';

  const email = body.email?.trim().toLowerCase() ?? '';
  if (!email) {
    fields.email = 'Required.';
  } else if (!email.endsWith(SCHOOL_DOMAIN)) {
    fields.email = `Use your ${SCHOOL_DOMAIN} address.`;
  }

  if (!body.password || body.password.length < MIN_PASSWORD) {
    fields.password = `At least ${MIN_PASSWORD} characters.`;
  }
  if (body.password !== body.confirmPassword) {
    fields.confirmPassword = 'Passwords do not match.';
  }

  return fields;
}

authRouter.post('/signup/student', async (req, res) => {
  const body = req.body as SignUpBody;
  const fields = validateSignUp(body);
  if (Object.keys(fields).length) {
    return fail(res, 422, 'validation_failed', 'Check the form.', fields);
  }

  const email = body.email!.trim().toLowerCase();
  if (await Student.exists({ email })) {
    return fail(res, 422, 'validation_failed', 'Check the form.', {
      email: 'That email is already registered.',
    });
  }

  const student = await Student.create({
    firstName: body.firstName!.trim(),
    lastName: body.lastName!.trim(),
    email,
    passwordHash: await bcrypt.hash(body.password!, 10),
    homeStop: body.homeStopId || null,
  });

  const user: CurrentUser = { role: 'student', ...toStudent(student.toObject()) };
  const session: AuthSession = {
    token: issueToken({ sub: user.id, role: 'student' }),
    user,
  };
  return res.status(201).json(session);
});

/**
 * Driver sign-up returns no session.
 *
 * Staff approve driver accounts before they can sign in, so handing back
 * a token here would defeat the gate entirely.
 */
authRouter.post('/signup/driver', async (req, res) => {
  const body = req.body as SignUpBody;
  const fields = validateSignUp(body);
  if (Object.keys(fields).length) {
    return fail(res, 422, 'validation_failed', 'Check the form.', fields);
  }

  const email = body.email!.trim().toLowerCase();
  if (await Driver.exists({ email })) {
    return fail(res, 422, 'validation_failed', 'Check the form.', {
      email: 'That email is already registered.',
    });
  }

  await Driver.create({
    firstName: body.firstName!.trim(),
    lastName: body.lastName!.trim(),
    email,
    passwordHash: await bcrypt.hash(body.password!, 10),
    /* Bus is assigned by staff on approval, never chosen at sign-up. */
    bus: null,
    approved: false,
  });

  return res.status(201).json({ pending: true });
});

authRouter.post('/signin', async (req, res) => {
  const { email, password, role } = req.body as {
    email?: string;
    password?: string;
    role?: 'student' | 'driver';
  };

  if (!email || !password) {
    return fail(res, 422, 'validation_failed', 'Enter your email and password.');
  }

  const normalised = email.trim().toLowerCase();

  /* The role from the form is enforced, not just a hint: a student who
     signs in on the Driver tab is rejected rather than silently landing
     in the wrong app. */
  const account =
    role === 'driver'
      ? await Driver.findOne({ email: normalised })
      : await Student.findOne({ email: normalised });

  if (!account || !(await bcrypt.compare(password, account.get('passwordHash')))) {
    return fail(res, 401, 'unauthorized', 'That email and password do not match.');
  }

  if (role === 'driver' && !account.get('approved')) {
    return fail(
      res,
      403,
      'not_approved',
      'Your driver account is waiting on approval from transportation staff.',
    );
  }

  const plain = account.toObject();
  const user: CurrentUser =
    role === 'driver'
      ? { role: 'driver', ...toDriver(plain) }
      : { role: 'student', ...toStudent(plain) };

  const session: AuthSession = {
    token: issueToken({ sub: user.id, role: user.role }),
    user,
  };
  return res.json(session);
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const plain = req.account.toObject();
  const user: CurrentUser =
    req.auth!.role === 'driver'
      ? { role: 'driver', ...toDriver(plain) }
      : { role: 'student', ...toStudent(plain) };
  return res.json(user);
});

/** Tokens are stateless, so signing out is a client-side discard. */
authRouter.post('/signout', (_req, res) => res.json(null));
