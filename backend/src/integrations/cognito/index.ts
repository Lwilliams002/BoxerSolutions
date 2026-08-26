import crypto from 'crypto';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { config } from '../../config';
import { ApiError } from '../../utils/errors';

interface CognitoResponseError {
  __type?: string;
  message?: string;
}

class CognitoServiceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'CognitoServiceError';
  }
}

function assertConfigured() {
  if (!config.cognito.region || !config.cognito.userPoolClientId) {
    throw new ApiError(
      500,
      'Cognito OTP is enabled but missing config. Set COGNITO_REGION and COGNITO_USER_POOL_CLIENT_ID.',
    );
  }
}

function assertAdminConfigured() {
  if (!config.cognito.region || !config.cognito.userPoolId) {
    throw new ApiError(
      500,
      'Cognito user provisioning is enabled but missing COGNITO_REGION or COGNITO_USER_POOL_ID.',
    );
  }
}

function endpoint() {
  return `https://cognito-idp.${config.cognito.region}.amazonaws.com/`;
}

const adminClient = new CognitoIdentityProviderClient({
  region: config.cognito.region || undefined,
});

function secretHash(username: string) {
  if (!config.cognito.userPoolClientSecret) return undefined;
  return crypto
    .createHmac('sha256', config.cognito.userPoolClientSecret)
    .update(`${username}${config.cognito.userPoolClientId}`)
    .digest('base64');
}

async function cognitoCall<T>(target: string, payload: unknown): Promise<T> {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as T & CognitoResponseError;
  if (!res.ok) {
    const code = (json.__type ?? 'CognitoError').split('#').pop() as string;
    const message = json.message ?? 'Cognito request failed';
    throw new CognitoServiceError(code, message);
  }
  return json as T;
}

type StartAuthResponse = {
  ChallengeName?: string;
  Session?: string;
  AuthenticationResult?: unknown;
};

type RespondChallengeResponse = {
  ChallengeName?: string;
  Session?: string;
  AuthenticationResult?: unknown;
};

type InitiateAuthResponse = {
  ChallengeName?: string;
  Session?: string;
  AuthenticationResult?: unknown;
};

export const cognitoOtp = {
  async startEmailOtp(username: string) {
    assertConfigured();
    const secret = secretHash(username);
    const authParameters: Record<string, string> = {
      USERNAME: username,
      PREFERRED_CHALLENGE: 'EMAIL_OTP',
    };
    if (secret) authParameters.SECRET_HASH = secret;

    const start = await cognitoCall<StartAuthResponse>('InitiateAuth', {
      AuthFlow: 'USER_AUTH',
      ClientId: config.cognito.userPoolClientId,
      AuthParameters: authParameters,
    });

    let session = start.Session;
    let challengeName = start.ChallengeName;

    // Some pools return SELECT_CHALLENGE first. Select EMAIL_OTP explicitly.
    if (challengeName === 'SELECT_CHALLENGE' && session) {
      const challengeResponses: Record<string, string> = {
        USERNAME: username,
        ANSWER: 'EMAIL_OTP',
      };
      if (secret) challengeResponses.SECRET_HASH = secret;
      const selected = await cognitoCall<RespondChallengeResponse>('RespondToAuthChallenge', {
        ClientId: config.cognito.userPoolClientId,
        ChallengeName: 'SELECT_CHALLENGE',
        Session: session,
        ChallengeResponses: challengeResponses,
      });
      session = selected.Session;
      challengeName = selected.ChallengeName;
    }

    if (!session || challengeName !== 'EMAIL_OTP') {
      throw new ApiError(502, 'Cognito did not start an EMAIL_OTP challenge for this user.');
    }

    return { session };
  },

  async verifyEmailOtp(username: string, code: string, session: string) {
    assertConfigured();
    const secret = secretHash(username);
    const challengeResponses: Record<string, string> = {
      USERNAME: username,
      EMAIL_OTP_CODE: code,
    };
    if (secret) challengeResponses.SECRET_HASH = secret;

    const response = await cognitoCall<RespondChallengeResponse>('RespondToAuthChallenge', {
      ClientId: config.cognito.userPoolClientId,
      ChallengeName: 'EMAIL_OTP',
      Session: session,
      ChallengeResponses: challengeResponses,
    });

    if (!response.AuthenticationResult) {
      throw ApiError.unauthorized('Invalid or expired code');
    }
  },
};

function toUnauthorized(err: unknown) {
  if (err instanceof CognitoServiceError) {
    if (err.code === 'NotAuthorizedException' || err.code === 'UserNotFoundException') {
      return ApiError.unauthorized('Invalid email or password');
    }
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    ((err as { name?: string }).name === 'NotAuthorizedException' ||
      (err as { name?: string }).name === 'UserNotFoundException')
  ) {
    return ApiError.unauthorized('Invalid email or password');
  }
  return err;
}

function randomPassword() {
  return `${crypto.randomBytes(8).toString('base64url')}Aa1!`;
}

function isCognitoFlowConfigError(err: unknown) {
  if (!(err instanceof CognitoServiceError)) return false;
  return (
    err.code === 'InvalidParameterException' &&
    (err.message.includes('flow not enabled') ||
      err.message.includes('Missing required parameter') ||
      err.message.includes('Invalid auth flow'))
  );
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function verifyWithUserPasswordAuth(
  username: string,
  password: string,
  authParameters: Record<string, string>,
) {
  const result = await cognitoCall<InitiateAuthResponse>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: config.cognito.userPoolClientId,
    AuthParameters: authParameters,
  });

  if (!result.AuthenticationResult) throw ApiError.unauthorized('Invalid email or password');
}

async function verifyWithUserAuth(username: string, password: string, secret?: string) {
  const authParameters: Record<string, string> = {
    USERNAME: username,
    PREFERRED_CHALLENGE: 'PASSWORD',
    PASSWORD: password,
  };
  if (secret) authParameters.SECRET_HASH = secret;

  const start = await cognitoCall<StartAuthResponse>('InitiateAuth', {
    AuthFlow: 'USER_AUTH',
    ClientId: config.cognito.userPoolClientId,
    AuthParameters: authParameters,
  });

  let session = start.Session;
  let challengeName = start.ChallengeName;
  let authResult = start.AuthenticationResult;

  if (challengeName === 'SELECT_CHALLENGE' && session) {
    const challengeResponses: Record<string, string> = {
      USERNAME: username,
      ANSWER: 'PASSWORD',
      PASSWORD: password,
    };
    if (secret) challengeResponses.SECRET_HASH = secret;

    const selected = await cognitoCall<RespondChallengeResponse>('RespondToAuthChallenge', {
      ClientId: config.cognito.userPoolClientId,
      ChallengeName: 'SELECT_CHALLENGE',
      Session: session,
      ChallengeResponses: challengeResponses,
    });
    session = selected.Session;
    challengeName = selected.ChallengeName;
    authResult = selected.AuthenticationResult;
  }

  if (!authResult && challengeName === 'PASSWORD' && session) {
    const challengeResponses: Record<string, string> = {
      USERNAME: username,
      PASSWORD: password,
    };
    if (secret) challengeResponses.SECRET_HASH = secret;

    const challenged = await cognitoCall<RespondChallengeResponse>('RespondToAuthChallenge', {
      ClientId: config.cognito.userPoolClientId,
      ChallengeName: 'PASSWORD',
      Session: session,
      ChallengeResponses: challengeResponses,
    });
    authResult = challenged.AuthenticationResult;
  }

  if (!authResult) throw ApiError.unauthorized('Invalid email or password');
}

async function verifyWithAdminPasswordAuth(username: string, password: string, secret?: string) {
  if (!config.cognito.userPoolId) {
    throw new ApiError(502, 'Cognito employee login is missing COGNITO_USER_POOL_ID.');
  }

  const authParameters: Record<string, string> = {
    USERNAME: username,
    PASSWORD: password,
  };
  if (secret) authParameters.SECRET_HASH = secret;

  const result = await adminClient.send(
    new AdminInitiateAuthCommand({
      UserPoolId: config.cognito.userPoolId,
      ClientId: config.cognito.userPoolClientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: authParameters,
    }),
  );

  if (!result.AuthenticationResult) throw ApiError.unauthorized('Invalid email or password');
}

export const cognitoAuth = {
  async verifyUserPassword(username: string, password: string) {
    assertConfigured();
    const secret = secretHash(username);
    const authParameters: Record<string, string> = { USERNAME: username, PASSWORD: password };
    if (secret) authParameters.SECRET_HASH = secret;

    const flowErrors: string[] = [];
    try {
      await verifyWithUserPasswordAuth(username, password, authParameters);
      return;
    } catch (err) {
      if (!isCognitoFlowConfigError(err)) throw toUnauthorized(err);
      flowErrors.push(errorMessage(err));
    }

    try {
      await verifyWithUserAuth(username, password, secret);
      return;
    } catch (err) {
      if (!isCognitoFlowConfigError(err)) throw toUnauthorized(err);
      flowErrors.push(errorMessage(err));
    }

    try {
      await verifyWithAdminPasswordAuth(username, password, secret);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (!isCognitoFlowConfigError(err)) throw toUnauthorized(err);
      flowErrors.push(errorMessage(err));
      throw new ApiError(
        502,
        `Cognito employee login is misconfigured. Enable password auth on the app client or set COGNITO_USER_POOL_ID. Errors: ${flowErrors.join(' | ')}`,
      );
    }
  },

  async requestPasswordReset(username: string) {
    assertConfigured();
    try {
      const secret = secretHash(username);
      const payload: { ClientId: string; Username: string; SecretHash?: string } = {
        ClientId: config.cognito.userPoolClientId,
        Username: username,
      };
      if (secret) payload.SecretHash = secret;
      await cognitoCall('ForgotPassword', payload);
    } catch (err) {
      // Keep request semantics non-enumerable from API surface.
      if (err instanceof CognitoServiceError && err.code === 'UserNotFoundException') return;
      throw err;
    }
  },

  async confirmPasswordReset(username: string, code: string, newPassword: string) {
    assertConfigured();
    try {
      const secret = secretHash(username);
      const payload: {
        ClientId: string;
        Username: string;
        ConfirmationCode: string;
        Password: string;
        SecretHash?: string;
      } = {
        ClientId: config.cognito.userPoolClientId,
        Username: username,
        ConfirmationCode: code,
        Password: newPassword,
      };
      if (secret) payload.SecretHash = secret;
      await cognitoCall('ConfirmForgotPassword', payload);
    } catch (err) {
      if (err instanceof CognitoServiceError) {
        if (err.code === 'CodeMismatchException' || err.code === 'ExpiredCodeException') {
          throw ApiError.badRequest('Invalid or expired reset code');
        }
        if (err.code === 'InvalidPasswordException') {
          throw ApiError.badRequest(err.message);
        }
      }
      throw err;
    }
  },
};

export const cognitoUsers = {
  async ensureUser(email: string) {
    assertAdminConfigured();
    const username = email.trim().toLowerCase();
    try {
      await adminClient.send(
        new AdminCreateUserCommand({
          UserPoolId: config.cognito.userPoolId,
          Username: username,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: username },
            { Name: 'email_verified', Value: 'true' },
          ],
        }),
      );

      await adminClient.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: config.cognito.userPoolId,
          Username: username,
          Password: randomPassword(),
          Permanent: true,
        }),
      );
    } catch (err: any) {
      if (err?.name === 'UsernameExistsException') {
        return;
      }
      throw new ApiError(502, `Failed to provision Cognito user for email ${username}`);
    }
  },

  async ensureCustomerUser(email: string) {
    return this.ensureUser(email);
  },

  async ensureEmployeeUser(email: string) {
    return this.ensureUser(email);
  },
};
