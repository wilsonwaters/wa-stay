/**
 * User Test Fixtures
 */

import { User, UserInput } from '@shared/types';

export const mockUserInput: UserInput = {
  email: 'test@example.com',
  password: 'TestPassword123!',
  firstName: 'John',
  lastName: 'Doe',
  phone: '+61412345678',
};

export const mockUserInput2: UserInput = {
  email: 'jane@example.com',
  password: 'SecurePass456!',
  firstName: 'Jane',
  lastName: 'Smith',
  phone: '+61487654321',
};

export const mockUser: User = {
  id: 1,
  email: 'test@example.com',
  encryptedPassword: 'encrypted-password-hash',
  firstName: 'John',
  lastName: 'Doe',
  phone: '+61412345678',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

export const mockUser2: User = {
  id: 2,
  email: 'jane@example.com',
  encryptedPassword: 'encrypted-password-hash-2',
  firstName: 'Jane',
  lastName: 'Smith',
  phone: '+61487654321',
  createdAt: new Date('2024-01-02T00:00:00Z'),
  updatedAt: new Date('2024-01-02T00:00:00Z'),
};

export const invalidUserInputs = [
  {
    ...mockUserInput,
    email: 'invalid-email',
    expectedError: 'Invalid email format',
  },
  {
    ...mockUserInput,
    password: 'short',
    expectedError: 'Password must be at least 8 characters',
  },
  {
    ...mockUserInput,
    phone: 'invalid-phone',
    expectedError: 'Invalid phone format',
  },
];

export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    ...mockUser,
    ...overrides,
  };
}

export function createMockUserInput(overrides: Partial<UserInput> = {}): UserInput {
  return {
    ...mockUserInput,
    ...overrides,
  };
}
