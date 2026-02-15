import { describe, it, expect } from 'vitest';
import { createSteeringQueue } from './steering.js';

describe('SteeringQueue', () => {
  it('should queue and drain steering messages as SteeringTurn objects', () => {
    const queue = createSteeringQueue();

    queue.steer('First message');
    queue.steer('Second message');

    const steered = queue.drainSteering();

    expect(steered).toHaveLength(2);
    expect(steered[0]).toEqual({
      kind: 'steering',
      content: 'First message',
    });
    expect(steered[1]).toEqual({
      kind: 'steering',
      content: 'Second message',
    });
  });

  it('should queue and drain follow-up messages', () => {
    const queue = createSteeringQueue();

    queue.followUp('Follow-up 1');
    queue.followUp('Follow-up 2');

    const followUps = queue.drainFollowUp();

    expect(followUps).toHaveLength(2);
    expect(followUps[0]).toBe('Follow-up 1');
    expect(followUps[1]).toBe('Follow-up 2');
  });

  it('should clear steering queue after drain', () => {
    const queue = createSteeringQueue();

    queue.steer('Message');
    queue.drainSteering();

    const secondDrain = queue.drainSteering();
    expect(secondDrain).toHaveLength(0);
  });

  it('should clear follow-up queue after drain', () => {
    const queue = createSteeringQueue();

    queue.followUp('Message');
    queue.drainFollowUp();

    const secondDrain = queue.drainFollowUp();
    expect(secondDrain).toHaveLength(0);
  });

  it('should maintain order of steering messages', () => {
    const queue = createSteeringQueue();

    const messages = ['A', 'B', 'C', 'D', 'E'];
    messages.forEach((msg) => queue.steer(msg));

    const steered = queue.drainSteering();

    expect(steered).toHaveLength(5);
    steered.forEach((turn, i) => {
      expect(turn.content).toBe(messages[i]);
    });
  });

  it('should maintain order of follow-up messages', () => {
    const queue = createSteeringQueue();

    const messages = ['X', 'Y', 'Z'];
    messages.forEach((msg) => queue.followUp(msg));

    const followUps = queue.drainFollowUp();

    expect(followUps).toEqual(messages);
  });

  it('should correctly report hasSteering when queue is empty', () => {
    const queue = createSteeringQueue();

    expect(queue.hasSteering()).toBe(false);

    queue.steer('Message');
    expect(queue.hasSteering()).toBe(true);

    queue.drainSteering();
    expect(queue.hasSteering()).toBe(false);
  });

  it('should correctly report hasFollowUp when queue is empty', () => {
    const queue = createSteeringQueue();

    expect(queue.hasFollowUp()).toBe(false);

    queue.followUp('Message');
    expect(queue.hasFollowUp()).toBe(true);

    queue.drainFollowUp();
    expect(queue.hasFollowUp()).toBe(false);
  });

  it('should independently manage steering and follow-up queues', () => {
    const queue = createSteeringQueue();

    queue.steer('Steer 1');
    queue.steer('Steer 2');
    queue.followUp('Follow 1');
    queue.followUp('Follow 2');

    const steered = queue.drainSteering();
    expect(steered).toHaveLength(2);
    expect(queue.hasFollowUp()).toBe(true);

    const followUps = queue.drainFollowUp();
    expect(followUps).toHaveLength(2);
    expect(queue.hasSteering()).toBe(false);
  });

  it('should handle interleaved steer and followUp calls', () => {
    const queue = createSteeringQueue();

    queue.steer('Steer 1');
    queue.followUp('Follow 1');
    queue.steer('Steer 2');
    queue.followUp('Follow 2');

    const steered = queue.drainSteering();
    expect(steered).toHaveLength(2);
    expect(steered[0]?.content).toBe('Steer 1');
    expect(steered[1]?.content).toBe('Steer 2');

    const followUps = queue.drainFollowUp();
    expect(followUps).toHaveLength(2);
    expect(followUps[0]).toBe('Follow 1');
    expect(followUps[1]).toBe('Follow 2');
  });
});
