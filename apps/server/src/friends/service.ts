import { prisma } from '../db';

export const orderPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export async function friendIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.friendship.findMany({
    where: { OR: [{ userA: userId }, { userB: userId }] },
    select: { userA: true, userB: true },
  });
  return rows.map((r) => (r.userA === userId ? r.userB : r.userA));
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const [userA, userB] = orderPair(a, b);
  return !!(await prisma.friendship.findUnique({ where: { userA_userB: { userA, userB } }, select: { userA: true } }));
}

/** Чи заблокував хтось із двох іншого */
export async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  return !!(await prisma.block.findFirst({
    where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] },
    select: { blockerId: true },
  }));
}

export async function hasBlocked(blocker: string, blocked: string): Promise<boolean> {
  return !!(await prisma.block.findUnique({ where: { blockerId_blockedId: { blockerId: blocker, blockedId: blocked } }, select: { blockerId: true } }));
}
