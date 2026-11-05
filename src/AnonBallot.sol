// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

/// @title AnonBallot
/// @notice Anonymous, once-per-nurse ballots built on Semaphore V4.
///
/// Design notes (no owner, no admin, no voter registry):
/// - AnonBallot holds NO owner/admin role and exposes NO function that adds, removes
///   or updates a voter. Membership lives exclusively in the Semaphore group that is
///   created per ballot; only that group's admin (the address that called
///   `createBallot`, see below) can change it, and only by calling the Semaphore
///   contract itself (`Semaphore.addMember/addMembers/updateMember/removeMember`).
/// - One Semaphore group per ballot. This keeps each ballot's membership list and its
///   scope separate, so a proof made for one ballot cannot be replayed on another.
/// - The scope is derived ONLY from contract state: `keccak256(abi.encode(address(this), ballotId))`.
///   It never depends on the caller, the timestamp, or any voter-supplied value.
contract AnonBallot {
    /// @notice Everything stored for a single ballot.
    /// @dev `tally` is index-aligned with the option ids: `tally[i]` is the number of
    ///      votes whose proof carried `message == i`.
    struct Ballot {
        string question;
        uint8 optionCount;
        uint64 closesAt;
        uint256 groupId;
        uint256 scope;
        uint256[] tally;
    }

    error OptionCountTooSmall();
    error BallotClosed();
    error ScopeMismatch();
    error OptionOutOfRange();

    /// @notice The Semaphore V4 core contract used for group + proof validation.
    ISemaphore public immutable semaphore;

    /// @notice Number of ballots created so far; also the id of the next ballot.
    uint256 public ballotCount;

    /// @notice Ballot storage keyed by ballot id.
    mapping(uint256 => Ballot) private ballots;

    /// @notice Emitted when a ballot is created. Contains no voter information.
    event BallotCreated(
        uint256 indexed ballotId,
        uint256 indexed groupId,
        uint256 scope,
        string question,
        uint8 optionCount,
        uint64 closesAt
    );

    /// @notice Emitted once per accepted vote.
    /// @dev `nullifier` is the per-scope Semaphore nullifier, not an identity: it is
    ///      unlinkable to a commitment without the identity's secret.
    event VoteCast(uint256 indexed ballotId, uint256 option, uint256 nullifier);

    /// @param semaphore_ Address of the deployed `Semaphore` contract.
    constructor(address semaphore_) {
        require(semaphore_ != address(0), "AnonBallot: semaphore is zero");
        semaphore = ISemaphore(semaphore_);
    }

    /// @notice Creates a ballot and the Semaphore group that will hold its voters.
    /// @dev The caller becomes the Semaphore *group admin* for this ballot's group, so the
    ///      ward admin (Priya) adds identity commitments by calling
    ///      `Semaphore.addMembers(groupId, commitments)` directly - never through this contract.
    ///      The group's Merkle-root validity window is set to the remaining ballot lifetime
    ///      plus one day so that proofs generated during setup stay valid until after closing.
    /// @param question Human readable ballot question.
    /// @param optionCount Number of distinct options, must be >= 2.
    /// @param closesAt Unix timestamp after which votes are rejected, must be in the future.
    /// @return ballotId The id of the newly created ballot.
    function createBallot(string calldata question, uint8 optionCount, uint64 closesAt)
        external
        returns (uint256 ballotId)
    {
        if (optionCount < 2) revert OptionCountTooSmall();
        if (closesAt <= block.timestamp) revert BallotClosed();

        ballotId = ballotCount++;

        uint256 groupId = semaphore.createGroup(msg.sender, uint256(closesAt) - block.timestamp + 1 days);
        uint256 scope = uint256(keccak256(abi.encode(address(this), ballotId)));

        Ballot storage ballot = ballots[ballotId];
        ballot.question = question;
        ballot.optionCount = optionCount;
        ballot.closesAt = closesAt;
        ballot.groupId = groupId;
        ballot.scope = scope;
        ballot.tally = new uint256[](optionCount);

        emit BallotCreated(ballotId, groupId, scope, question, optionCount, closesAt);
    }

    /// @notice Casts one anonymous vote.
    /// @dev This function body deliberately never reads, checks, stores or emits
    ///      `msg.sender` or `tx.origin`: the option is taken exclusively from
    ///      `proof.message`, and the nullifier is recorded by `Semaphore.validateProof`,
    ///      which reverts if this identity already voted in this scope.
    /// @param ballotId The ballot being voted on.
    /// @param proof A Semaphore proof whose `scope` equals this ballot's scope and whose
    ///              `message` is the chosen option id.
    function castVote(uint256 ballotId, ISemaphore.SemaphoreProof calldata proof) external {
        Ballot storage ballot = ballots[ballotId];

        if (block.timestamp >= ballot.closesAt) revert BallotClosed();
        if (proof.scope != ballot.scope) revert ScopeMismatch();
        if (proof.message >= ballot.optionCount) revert OptionOutOfRange();

        // State-changing validation: verifies the proof AND records the nullifier, so a
        // reused nullifier reverts here. The view-only `verifyProof` is deliberately NOT used.
        semaphore.validateProof(ballot.groupId, proof);

        ballot.tally[proof.message] += 1;

        emit VoteCast(ballotId, proof.message, proof.nullifier);
    }

    /// @notice Returns the current tally of a ballot, index-aligned with option ids.
    function getTally(uint256 ballotId) external view returns (uint256[] memory) {
        return ballots[ballotId].tally;
    }

    /// @notice Returns everything stored for a ballot.
    function getBallot(uint256 ballotId) external view returns (Ballot memory) {
        return ballots[ballotId];
    }
}
