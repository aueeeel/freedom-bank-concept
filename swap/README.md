# Additional SWAP demonstration

The API provided three chats (RU/KZ/EN). They are saved in the user's local submission folder and have not been graded. SWAP is separate from results/prod. Its future instructions are not yet known.

Place your downloaded array in swap/swap_dialogues.json (ignored by Git). After receiving the additional instruction, explicitly choose the rubric:

    python swap/evaluate_swap.py --checker-root checker --rubric checker/config/checklist.official.json --confirm-evaluation

This demo exports the existing eight criterion IDs. A new criterion structure needs its own exporter. No inference runs without --confirm-evaluation. All generated files stay under swap/, never results/prod.
